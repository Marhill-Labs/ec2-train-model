//
const node_ssh = require('node-ssh');
const ssh = new node_ssh();

const REPO = 'ec2-train-model';

if (!process.argv[2]) {
  console.log('Missing argument for CARD_SET');
  console.log('Example: node auto-ec2.js 3ed');
  process.exit();
}

let request_spot = true;

// add an extra command to choose an on demand instance instead
if (process.argv[3]) {
  request_spot = false;
  console.log('Spot mode disabled.  Using on-demand compute.');
}

const CARD_SET = process.argv[2];

console.log(`Initialized with ${CARD_SET} CARD_SET.`);

const AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region: 'us-west-2'});

const INSTANCE_TYPE = 'p2.xlarge';
const AMI = 'ami-0b63040ee445728bf';

async function main() {

  const [instance_id, availability_zone] = request_spot ? await getSpot() : await getRegular();
  console.log('Waiting for Instance to be ready.  Please be patient...');

  const params = {InstanceIds: [instance_id]};
  await waitForInstance(params);
  console.log('Instance Ready');

  const described = await describeInstance(params);
  const public_dns = described.Reservations[0].Instances[0].PublicDnsName;
  console.log(public_dns);

  console.log('Create a Volume');
  const volume_id = await createVolume(availability_zone);

  console.log('Waiting for Volume to be Ready');
  const volume_params = {VolumeIds:[volume_id]};
  await waitForVolume(volume_params);
  console.log('Volume Ready');

  console.log('Attaching Volume');
  await attachVolume(instance_id, volume_id);

  await shellCommands(public_dns);

  console.log('Shutting Down Instance');
  await terminateInstance(params);
  console.log('Waiting for Instance to shut down...');
  await confirmInstanceTerminated(params);
  console.log('Instance Terminated');
  console.log('Cleaning up Volume');
  await deleteVolume(volume_id);
  console.log('Waiting for Volume to be removed...');
  await confirmVolumeDeleted(volume_params);
  console.log('Volume removed successfully');

  console.log('All Done!');
}


main();



async function getSpot() {
  const spot_price = await getSpotPrice();
  console.log(`Spot Price: ${spot_price}`);

  console.log('Requesting Spot Instance');
  const requested_spot_instance = await getSpotInstance(spot_price);
  console.log('Spot Instance Requested.  Please wait...');

  const request_id = requested_spot_instance.SpotInstanceRequests[0].SpotInstanceRequestId;

  const spot_instance = await waitForSpotInstanceRequestFulfilled(request_id);
  console.log('Spot Instance Request Fulfilled');

  const instance_id = spot_instance.SpotInstanceRequests[0].InstanceId;
  console.log(instance_id);
  const availability_zone = spot_instance.SpotInstanceRequests[0].LaunchedAvailabilityZone;
  console.log(availability_zone);

  return [instance_id, availability_zone];
}

async function getRegular() {

  // AMIs are region-specific
  const instanceParams = {
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/sda1",  // /dev/xvda1
        Ebs: {
          VolumeSize: 150
        }
      }
    ],
    ImageId: AMI,
    InstanceType: INSTANCE_TYPE,
    KeyName: 'key_acs',
    MinCount: 1,
    MaxCount: 1
  };

  const instance_details = await ec2.runInstances(instanceParams).promise();
  console.log(instance_details);

  const instance_id = instance_details.Instances[0].InstanceId;
  const availability_zone = instance_details.Instances[0].Placement.AvailabilityZone;
  console.log(availability_zone);

  return [instance_id, availability_zone];
}

async function confirmVolumeDeleted(volume_params) {
  return new Promise((resolve, reject) => {
    ec2.waitFor('volumeDeleted', volume_params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  });
}

async function deleteVolume(volume_id) {
  const params = {
    VolumeId: volume_id
  };
  return new Promise((resolve, reject) => {
    ec2.deleteVolume(params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  });
}

async function confirmInstanceTerminated(params) {
  return new Promise((resolve, reject) => {
    ec2.waitFor('instanceTerminated', params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else{
        console.log(data);
        resolve(data);
      }
    });
  })
}

async function describeInstance(params) {
  return new Promise((resolve, reject) => {
    ec2.describeInstances(params, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  });
}


async function waitForInstance(params) {
  return new Promise((resolve, reject) => {
    ec2.waitFor('instanceStatusOk', params, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  })
}

function waitForSpotInstanceRequestFulfilled(request_id) {
  const params = {
    SpotInstanceRequestIds: [request_id]
  };

  return new Promise((resolve, reject) => {
    ec2.waitFor('spotInstanceRequestFulfilled', params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  });
}

function getSpotInstance(spot_price) {
  const params = {
    InstanceCount: 1,
    InstanceInterruptionBehavior: 'terminate',
    LaunchSpecification: {
      BlockDeviceMappings: [
        {
          DeviceName: "/dev/sda1",  // /dev/xvda1
          Ebs: {
            VolumeSize: 150,
            VolumeType: 'gp2',
            DeleteOnTermination: true
          }
        }
      ],
      ImageId: AMI,
      InstanceType: INSTANCE_TYPE,
      KeyName: 'key_acs'
    },
    SpotPrice: spot_price,
    Type: "one-time"
  };

  return new Promise((resolve, reject) => {
    ec2.requestSpotInstances(params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  });

}


function getSpotPrice() {
  const an_hour_ago = new Date();
  an_hour_ago.setHours(an_hour_ago.getHours() - 1);

  const params = {
    InstanceTypes: [
      INSTANCE_TYPE
    ],
    ProductDescriptions: [
      "Linux/UNIX (Amazon VPC)"
    ],
    StartTime: an_hour_ago
  };

  return new Promise((resolve, reject)=> {
    ec2.describeSpotPriceHistory(params, function(err, data) {
      if (err){
        console.log(err);
        reject(err);
      } else {
        console.log(data);

        const max_spot = data.SpotPriceHistory.reduce((acc, spot_object)=> {
          const spot_price = Number(spot_object.SpotPrice);
          if(acc<spot_price) {
            return spot_price;
          } else {
            return acc;
          }
        }, 0);

        // add 5% buffer
        resolve(String(max_spot*1.05).slice(0,7));
      }
    });
  })
}

async function terminateInstance(params) {
  return new Promise((resolve, reject) => {
    ec2.terminateInstances(params, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve('done');
      }
    });
  });
}


async function attachVolume(instance_id, volume_id) {

  var params3 = {
    Device: "/dev/sdf",
    InstanceId: instance_id,
    VolumeId: volume_id
  };

  return new Promise((resolve, reject) => {
    ec2.attachVolume(params3, function(err, data) {
      if (err) {
        console.log(err);
        return reject(err);
      } else {
        console.log('Volume Attached');
        console.log(data);
        resolve(data);
      }
    });
  })
}

async function createVolume(availability_zone) {
  const cv_params = {
    AvailabilityZone: availability_zone,
    Size: 40,
    VolumeType: "gp2"
  };

  return new Promise((resolve, reject) => {
    ec2.createVolume(cv_params, function(err, data) {
      if (err){
        console.log(err, err.stack);
        return reject(err);
      } else {
        console.log('Volume Created');
        console.log(data);
        resolve(data.VolumeId)
      }
    });
  })
}

async function waitForVolume(params) {
  return new Promise((resolve, reject) => {
    ec2.waitFor('volumeAvailable', params, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log(data);
        resolve(data);
      }
    });
  })
}



async function shellCommands(public_dns) {

  await ssh.connect({
    host: public_dns,
    username: 'ubuntu',
    privateKey: '/home/daniel/Desktop/keys_credentials/key_acs.pem'
  });

  const format_volume = await ssh.execCommand(`sudo mkfs -t ext4 /dev/nvme1n1`);

  console.log(format_volume);

  const mount_volume = await ssh.execCommand(`sudo mount /dev/nvme1n1 /mnt`);

  console.log(mount_volume);

  const permissions = await ssh.execCommand(`sudo chown \`whoami\` /mnt`);

  console.log(permissions);

  const result = await ssh.execCommand(`cd /mnt && git clone https://github.com/Marhill-Labs/${REPO}.git`);

  console.log(result);

  await ssh.putFile('config.json', `/mnt/${REPO}/config.json`);

  console.log('Config copied.');
  console.log('Running...');

  const install_nvm = await ssh.execCommand('' +
    'wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.11/install.sh | bash');
  console.log(install_nvm.stdout);
  console.log(install_nvm.stderr);

  try {
    await ssh.exec('' +
      'export NVM_DIR="$HOME/.nvm" && ' +
      '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh" && ' +
      'nvm install 11 && npm install && ' +
      'node --version && node divide_dirs.js', [CARD_SET], {
      cwd: `/mnt/${REPO}`,
      onStdout(chunk) {
        console.log('stdoutChunk', chunk.toString('utf8'))
      },
      onStderr(chunk) {
        console.log('stderrChunk', chunk.toString('utf8'))
      }
    });
  } catch (e) {
    // ignore
  }

  try {
    await ssh.exec(`sudo apt-get update && source activate python3 && 
      pip install keras && pip install tensorflow-gpu && 
      pip install Pillow && pip install boto3 && python3 model.py`, [CARD_SET], {
      cwd: `/mnt/${REPO}`,
      onStdout(chunk) {
        console.log('stdoutChunk', chunk.toString('utf8'))
      },
      onStderr(chunk) {
        console.log('stderrChunk', chunk.toString('utf8'))
      }
    });
  } catch (e) {
    // ignore
  }

  ssh.dispose();

  console.log("Finished");


}
