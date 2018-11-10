import sys
import os
from keras import optimizers
from keras.models import Sequential
from keras.layers import Conv2D, MaxPooling2D, Dropout, Flatten, Dense, Activation
from keras import callbacks
from keras.preprocessing.image import ImageDataGenerator
from keras import backend as K
K.tensorflow_backend._get_available_gpus()

default_card_set = "3ed"

if len(sys.argv) > 1:
    print("Card Set: ", sys.argv[1])
    card_set = sys.argv[1]
else:
    print("Default Card Set: ", default_card_set)
    card_set = default_card_set

total = 0
for root, dirs, files in os.walk(card_set + "_sorted"):
    total += len(files)

img_width, img_height = 400, 400

nb_train_samples = total
batch_size = 32

epochs = 200
nb_filters1 = 64
nb_filters2 = 64
conv1_size = 3
conv2_size = 3
pool_size = 2
classes_num = 4
lr = 0.0003


input_shape = (img_height, img_width, 3)

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

model.compile(loss='categorical_crossentropy',
              optimizer=optimizers.RMSprop(lr=lr),
              metrics=['accuracy'])


test_datagen = ImageDataGenerator(rescale=1./255)

test_generator = test_datagen.flow_from_directory(
        card_set + '_sorted',
        target_size=(img_height, img_width),
        batch_size=batch_size,
        class_mode='categorical')

model.fit_generator(
    test_generator,
    steps_per_epoch=(nb_train_samples // batch_size),
    epochs=epochs
)

model.save_weights(card_set + '_weights.h5')
model.save(card_set + '_model.h5')
