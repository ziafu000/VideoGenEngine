const path = require('path');
const config = require('./config');
const jev = require('./jev');
const uploader = require('./facebook_uploader');

async function uploadReel({
  videoPath,
  caption = '',
  title = '',
  draft = false,
  storyboard = null
}) {
  return await uploader.uploadReel({
    videoPath,
    caption,
    title,
    draft,
    storyboard
  });
}

async function getStatus() {
  return await uploader.cmdStatus();
}

module.exports = {
  uploadReel,
  getStatus
};
