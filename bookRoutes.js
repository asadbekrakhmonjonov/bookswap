const express = require('express');
const { ObjectId } = require('mongodb');
const { body, validationResult } = require('express-validator');
const sanitize = require('mongo-sanitize');
const uploadToCloudinary = require('./cloudinary');
const { getDb } = require('./connect');
const { authenticateUser } = require('./userRoutes');
const cloudinary = require('cloudinary').v2;

const bookRoutes = express.Router();

const validateBook = [
  body('title').trim().notEmpty(),
  body('author').trim().notEmpty(),
  body('genre').trim().notEmpty(),
  body('condition').trim().notEmpty(),
  body('description').trim().notEmpty(),
  body('image').trim().notEmpty().isString(),
];

// CREATE
bookRoutes.post('/create', authenticateUser, validateBook, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), code: 'VALIDATION_ERROR' });
    }

    const db = getDb();
    const { title, author, genre, condition, description, image } = req.body;

    const sanitizedData = {
      title: sanitize(title),
      author: sanitize(author),
      genre: sanitize(genre),
      condition: sanitize(condition),
      description: sanitize(description),
      userId: new ObjectId(req.user._id),
      createdAt: new Date(),
      likes: 0,
    };

    const { url, public_id } = await uploadToCloudinary(image);
    sanitizedData.image = { url, public_id };

    const result = await db.collection('books').insertOne(sanitizedData);

    res.status(201).json({
      success: true,
      data: { ...sanitizedData, _id: result.insertedId },
      message: 'Book created successfully',
    });
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// GET ALL BOOKS
bookRoutes.get('/', async (req, res) => {
  try {
    const db = getDb();
    const books = await db.collection('books').find({}).sort({ createdAt: -1 }).toArray();

    res.status(200).json({
      success: true,
      data: books,
      message: 'Books retrieved successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// GET USER BOOKS
bookRoutes.get('/my-books', authenticateUser, async (req, res) => {
  try {
    const db = getDb();
    const books = await db.collection('books')
      .find({ userId: new ObjectId(req.user._id) })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: books,
      message: 'Books retrieved successfully',
    });
  } catch (error) {
    console.error('Error retrieving user books:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// UPDATE
bookRoutes.put('/my-books/:bookId', authenticateUser, async (req, res) => {
  try {
    const db = getDb();
    const { bookId } = req.params;
    const updateData = req.body;

    const userId = typeof req.user._id === 'string' ? new ObjectId(req.user._id) : req.user._id;
    const bookIdObj = new ObjectId(bookId);

    const result = await db.collection('books').findOneAndUpdate(
      { _id: bookIdObj, userId: userId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (result.value === null) {
      return res.status(404).json({
        success: false,
        error: 'Book not found or access denied',
        code: 'NOT_FOUND',
      });
    }

    res.status(200).json({
      success: true,
      data: result.value,
      message: 'Book updated successfully',
    });
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// DELETE
bookRoutes.delete('/my-books/:bookId', authenticateUser, async (req, res) => {
  try {
    const db = getDb();
    const { bookId } = req.params;
    const userId = typeof req.user._id === 'string' ? new ObjectId(req.user._id) : req.user._id;
    const bookIdObj = new ObjectId(bookId);

    const book = await db.collection('books').findOne({ _id: bookIdObj, userId });

    if (!book) {
      return res.status(404).json({ success: false, error: 'Book not found or access denied', code: 'NOT_FOUND' });
    }

    if (book.image && book.image.public_id) {
      try {
        await cloudinary.uploader.destroy(book.image.public_id, { resource_type: 'image' });
      } catch (cloudErr) {
        console.error('Error deleting image from Cloudinary:', cloudErr);
      }
    }

    const deleteResult = await db.collection('books').deleteOne({ _id: bookIdObj, userId });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Book not found or already deleted', code: 'NOT_FOUND' });
    }

    res.status(200).json({ success: true, message: 'Book and associated image deleted successfully' });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// LIKE
bookRoutes.put('/like/:bookId', async (req, res) => {
  try {
    const db = getDb();
    const { bookId } = req.params;
    const bookIdObj = new ObjectId(bookId);

    const result = await db.collection('books').findOneAndUpdate(
      { _id: bookIdObj },
      { $inc: { likes: 1 } },
      { returnDocument: 'after' }
    );

    if (result.value === null) {
      return res.status(404).json({ success: false, error: 'Book not found', code: 'NOT_FOUND' });
    }

    res.status(200).json({
      success: true,
      data: result.value,
      message: 'Likes updated successfully',
    });
  } catch (error) {
    console.error('Error updating likes:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

module.exports = { bookRoutes };
