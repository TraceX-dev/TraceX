const Type = {
  Any: (options = {}) => ({ ...options }),
  Array: (items, options = {}) => ({ ...options, items, type: 'array' }),
  Boolean: (options = {}) => ({ ...options, type: 'boolean' }),
  Enum: (values, options = {}) => ({
    ...options,
    enum: values,
    type: values.every((value) => typeof value === 'string') ? 'string' : undefined
  }),
  Null: (options = {}) => ({ ...options, type: 'null' }),
  Number: (options = {}) => ({ ...options, type: 'number' }),
  Object: (properties, options = {}) => ({
    ...options,
    properties,
    required: Object.entries(properties)
      .filter(([, schema]) => schema?.optional !== true)
      .map(([key]) => key),
    type: 'object'
  }),
  Optional: (schema) => ({ ...schema, optional: true }),
  String: (options = {}) => ({ ...options, type: 'string' }),
  Union: (schemas, options = {}) => ({ ...options, anyOf: schemas }),
  With: (schema, options = {}) => ({ ...schema, ...options })
}

module.exports = Type
module.exports.Type = Type
module.exports.default = Type
