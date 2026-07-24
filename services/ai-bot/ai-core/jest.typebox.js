const Type = {
  Number: (options = {}) => ({ ...options, type: 'number' }),
  Object: (properties, options = {}) => ({ ...options, properties, required: Object.keys(properties), type: 'object' }),
  String: (options = {}) => ({ ...options, type: 'string' })
}

module.exports = Type
module.exports.Type = Type
module.exports.default = Type
