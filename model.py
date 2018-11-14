import sys
import os
import json
import boto3

from botocore.exceptions import ClientError
from keras import optimizers
from keras.models import Sequential
from keras.layers import Conv2D, MaxPooling2D, Dropout, Flatten, Dense, Activation
from keras import callbacks
from keras.preprocessing.image import ImageDataGenerator
from keras.callbacks import ModelCheckpoint
from keras.models import load_model

from keras.utils import multi_gpu_model

from keras import backend as K
K.tensorflow_backend._get_available_gpus()

default_card_set = "3ed"

if not os.path.exists(default_card_set):
    os.makedirs(default_card_set)

if len(sys.argv) > 1:
    print("Card Set: ", sys.argv[1])
    card_set = sys.argv[1]
else:
    print("Default Card Set: ", default_card_set)
    card_set = default_card_set

TRAINING_DIR = card_set + '_sorted'
VALIDATION_SPLIT = 0.33

total = 0
dir_total = 0
for root, dirs, files in os.walk(card_set + "_sorted"):
    total += len(files)
    dir_total += len(dirs)

img_width, img_height = 400, 400

nb_train_samples = total
batch_size = 8 # todo 32

epochs = 200
nb_filters1 = 64
nb_filters2 = 64
conv1_size = 3
conv2_size = 3
pool_size = 2
classes_num = dir_total
lr = 0.0003

with open('config.json') as f:
    credentials = json.load(f)

s3 = boto3.resource('s3', aws_access_key_id=credentials["accessKeyId"], aws_secret_access_key=credentials["secretAccessKey"])


class S3Checkpoint(callbacks.Callback):
    def __init__(self, bucket, target_dir):
        self.bucket = bucket
        self.target_dir = target_dir

    def on_epoch_end(self, *args):
        epoch_nr, logs = args

        if not os.path.isdir(self.target_dir):
            raise ValueError('target_dir %r not found.' % self.target_dir)

        try:
            s3.create_bucket(Bucket=self.bucket, CreateBucketConfiguration={'LocationConstraint': 'us-west-2'})
        except ClientError:
            pass

        for filename in os.listdir(self.target_dir):
            my_bucket = s3.Bucket(self.bucket)
            match = False
            for obj in my_bucket.objects.filter(Prefix=filename):
                match = True
            if match == False:
                print('Uploading ' + filename + ' to Amazon S3 bucket ' + self.bucket)
                s3.Object(self.bucket, filename).put(Body=open(os.path.join(self.target_dir, filename), 'rb'))

input_shape = (img_height, img_width, 3)

# Check AWS if a model already exists
print("checking for existing models")
bucket_files = []
latest_val_acc = 0.0
latest_file = ""
my_bucket = s3.Bucket("model-" + card_set)
for obj in my_bucket.objects.all():
    bucket_files.append(obj.key)
    split_files = obj.key.split('.hdf5')[0].split('-')
    if float(split_files[2]) > latest_val_acc:
        latest_val_acc = float(split_files[2])
        latest_file = obj.key

if latest_file != "":
    try:
        print("downloading existing model")
        if not os.path.exists(card_set + '-model-aws-dl'):
            os.makedirs(card_set + '-model-aws-dl')
        my_bucket.download_file(latest_file, card_set + '-model-aws-dl/' + latest_file)
    except ClientError as e:
        if e.response['Error']['Code'] == "404":
            print("The object does not exist.")
        else:
            raise
    print('loading existing model into memory')
    model = load_model(card_set + '-model-aws-dl/' + latest_file)
    try:
        parallel_model = multi_gpu_model(model, cpu_relocation=True)
        print("Training using multiple GPUs..")
    except ValueError:
        parallel_model = model
        print("Training using single GPU or CPU..")
else:
    print('creating new model')
    model = Sequential()
    model.add(Conv2D(nb_filters1, (conv1_size, conv1_size), padding='same', input_shape=input_shape))
    model.add(Activation("relu"))
    model.add(MaxPooling2D(pool_size=(pool_size, pool_size)))

    model.add(Conv2D(nb_filters2, (conv2_size, conv2_size), padding='same'))
    model.add(Activation("relu"))
    model.add(MaxPooling2D(pool_size=(pool_size, pool_size)))

    model.add(Conv2D(nb_filters2, (conv2_size, conv2_size), padding='same'))
    model.add(Activation("relu"))
    model.add(MaxPooling2D(pool_size=(pool_size, pool_size)))

    model.add(Flatten())
    model.add(Dense(256))
    model.add(Activation("relu"))
    model.add(Dropout(0.2))
    model.add(Dense(classes_num, activation='softmax'))

    try:
        parallel_model = multi_gpu_model(model, cpu_relocation=True)
        print("Training using multiple GPUs..")
    except ValueError:
        parallel_model = model
        print("Training using single GPU or CPU..")

    parallel_model.compile(loss='categorical_crossentropy',
        optimizer=optimizers.RMSprop(lr=lr),
        metrics=['accuracy'])

if not os.path.exists(card_set + '-model-created'):
    os.makedirs(card_set + '-model-created')
filepath=card_set + "-model-created/" + card_set + "-{epoch:03d}-{val_loss:.3f}-{val_acc:.3f}.hdf5"

checkpoint = ModelCheckpoint(
    filepath,
    monitor='val_acc',
    verbose=1,
    save_best_only=True,
    mode='max')
s3_persist = S3Checkpoint(
    bucket='model-' + card_set,
    target_dir=card_set + '-model-created')

callbacks_list = [checkpoint, s3_persist]


data_generator = ImageDataGenerator(rescale=1./255, validation_split=VALIDATION_SPLIT)

train_generator = data_generator.flow_from_directory(TRAINING_DIR, target_size=(img_height, img_width), shuffle=True, seed=13,
                                                     class_mode='categorical', batch_size=batch_size, subset="training")

validation_generator = data_generator.flow_from_directory(TRAINING_DIR, target_size=(img_height, img_width), shuffle=True, seed=13,
                                                     class_mode='categorical', batch_size=batch_size, subset="validation")

parallel_model.fit_generator(
    train_generator,
    steps_per_epoch=(nb_train_samples // batch_size) * (1.0 - VALIDATION_SPLIT),
    epochs=epochs,
    callbacks=callbacks_list,
    validation_data=validation_generator,
    validation_steps=(nb_train_samples // batch_size) * VALIDATION_SPLIT
)
