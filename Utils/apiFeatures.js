class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach(el => delete queryObj[el]);

    // Advanced filtering
    // Strict operator sanitization to block NoSQL injection vectors like ($ne, $regex)
    // We sanitize by stripping out any keys that start with a literal '$' or are nested dangerously.
    let queryStr = JSON.stringify(queryObj);

    // Explicitly whitelist ONLY the safe operators your application expects
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, match => `$${match}`);

    const sanitizedQuery = JSON.parse(queryStr);

    // Deep sanitize the final object to strip out unauthorized NoSQL commands completely
    this._sanitizeObject(sanitizedQuery);

    this.query = this.query.find(sanitizedQuery);

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      //Use _id as a secondary tie-breaker to prevent pagination display skipping
      this.query = this.query.sort(`${sortBy} _id`);
    } else {
      // Default banking order: newest transactions first, breaking ties cleanly using object IDs
      this.query = this.query.sort('-createdAt _id');
    }

    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }

    return this;
  }

  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 100;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }

  // Helper utility to scan objects for unauthorized injection attempts recursively
  _sanitizeObject(obj) {
    if (obj !== null && typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        // Block un-whitelisted direct operator manipulation fields
        if (
          key.startsWith('$') &&
          !['$gt', '$gte', '$lt', '$lte'].includes(key)
        ) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          this._sanitizeObject(obj[key]);
        }
      });
    }
  }
}

module.exports = APIFeatures;
