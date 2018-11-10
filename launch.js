//
const node_ssh = require('node-ssh');
const ssh = new node_ssh();

const REPO = 'ec2-train-model';

if (!process.argv[2]) {
  console.log('Missing arguments for SAMPLES and/or CARD_SET');
  console.log('Example: node auto-ec2.js 100 3ed');
  process.exit();
}

const CARD_SET = process.argv[2];

console.log(`Initialized with ${CARD_SET} CARD_SET.`);

const AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region: 'us-west-2'});

// AMIs are region-specific
const instanceParams = {
  ImageId: 'ami-0bbe6b35405ecebdb',
  InstanceType: 't3.micro',   //c5.xlarge
  KeyName: 'key_acs',
  MinCount: 1,
  MaxCount: 1
};

main();


async function main() {

  const instance_details = await ec2.runInstances(instanceParams).promise();
  console.log(instance_details);

  const instance_id = instance_details.Instances[0].InstanceId;
  const availability_zone = instance_details.Instances[0].Placement.AvailabilityZone;
  console.log(availability_zone);

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
  await terminateInstance(params);

  console.log('All Done!');
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

async function describeInstance(params) {
  return new Promise((resolve, reject) => {
    ec2.describeInstances(params, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        console.log(JSON.stringify(data));
        resolve(data);
      }
    });
  });
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
    await ssh.exec(`sudo apt-get update && sudo apt-get install -y python3-pip &&
      pip3 install keras && pip3 install tensorflow && pip3 install Pillow && python3 model.py`, [CARD_SET], {
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


async function terminateInstance(params) {
  return new Promise((resolve, reject) => {
    ec2.terminateInstances(params, function (err, data) {
      if (err) {
        console.log(err, err.stack);
        reject(err);
      } else {
        console.log(data);
        resolve('done');
      }
    });
  });
}