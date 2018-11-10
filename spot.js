

const AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
const ec2 = new AWS.EC2({apiVersion: '2016-11-15', region: 'us-west-2'});

const INSTANCE_TYPE = "t3.micro";


async function main() {

  const spot_price = await getSpotPrice();
  console.log(`Spot Price: ${spot_price}`);

  console.log('Requesting Spot Instance');
  const requested_spot_instance = await getSpotInstance(spot_price);
  console.log('Spot Instance Requested.  Please wait...');

  const request_id = requested_spot_instance.SpotInstanceRequests[0].SpotInstanceRequestId;

  const spot_instance = await waitForSpotInstanceRequestFulfilled(request_id);
  console.log('Spot Instance Request Fulfilled');

}


main();

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
      ImageId: 'ami-0bbe6b35405ecebdb',
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
