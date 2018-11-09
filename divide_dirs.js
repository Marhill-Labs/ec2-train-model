const fs = require('fs');
const rimraf = require('rimraf');
const Promise = require('bluebird');

const AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
const s3 = new AWS.S3({apiVersion: '2006-03-01'});

if(!process.argv[2]) {
  console.log('Missing argument for CARD_SET');
  console.log('Example: node divide_dirs.js 3ed');
  process.exit();
}

const CARD_SET = process.argv[2];

console.log(`Initialized with ${CARD_SET} CARD_SET.`);

start();


async function processKeys(allKeys) {

  await removeRecursive(`./${CARD_SET}_sorted`);

  await fs.promises.mkdir(`./${CARD_SET}_sorted`);

  const folders_to_create = [];

  allKeys.forEach(object => {
    const file = object.Key;
    // start at index 1.  (accounts for 2 unique cards with same name... ie Forests)
    const split_name = file.split('_').slice(1).join('_').split('.jpg_')[0];
    folders_to_create.push(split_name);
  });

  const unique_folders = Array.from(new Set(folders_to_create));

  // make directories
  await unique_folders.map(folder_name => {
    return fs.promises.mkdir(`./${CARD_SET}_sorted/${folder_name}`);
  });

  await Promise.map(allKeys, (object, index) => {

    const folder = object.Key.split('_').slice(1).join('_').split('.jpg_')[0];
    const file = object.Key.split('.jpg_')[1];

    return new Promise((resolve, reject) => {

      var params = {
        Bucket: `mtg-train-${CARD_SET}`,
        Key: object.Key
      };
      s3.getObject(params, function(err, data) {
        if (err) {
          console.log(err);
          return reject(err);
        }

          fs.writeFile(`./${CARD_SET}_sorted/${folder}/${file}`, data.Body, function(err){
            if(err){
              console.log(err);
              return reject(err);
            }
            console.log(`${index} downloaded ${object.Key}`);
            resolve(object.Key);
          });

      });

    });
  }, { concurrency: 10 });

  console.log('done');

}


function removeRecursive(dir) {
  return new Promise((resolve, reject) => {
    rimraf(dir, {}, (err) => {
      if (err) {
        return reject('There was an error removing directory');
      }
      return resolve('finished');
    })
  })
}
function start() {

  listAllKeys(null, (allKeys) => {
    processKeys(allKeys);
  });

  let allKeys = [];

  function listAllKeys(token, cb)
  {
    const opts = { Bucket: `mtg-train-${CARD_SET}` };
    if(token) opts.ContinuationToken = token;

    s3.listObjectsV2(opts, function(err, data){
      allKeys = allKeys.concat(data.Contents);

      if(data.IsTruncated)
        listAllKeys(data.NextContinuationToken, cb);
      else{
        cb(allKeys);
      }
    });
  }
}

