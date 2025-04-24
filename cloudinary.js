const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const opts = {
  overwrite: true,
  invalidate: true,
  resource_type: 'auto',
  transformation: [
    {
      width: 300,
      height: 400,
      crop: 'fill',
      gravity: 'center',
      quality: 'auto',
    },
  ],
};

module.exports = (image) => {
  return new Promise((resolve, rejects) => {
    cloudinary.uploader.upload(image, opts, (error, result) => {
      if (result && result.secure_url) {
        console.log(result.secure_url);
        return resolve({
          url: result.secure_url,
          public_id: result.public_id,  // Return both url and public_id
        });
      }
      console.log(error.message);
      return rejects({ message: error.message });
    });
  });
};
