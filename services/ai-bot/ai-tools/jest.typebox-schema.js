function check (schema, value) {
  if (schema?.optional === true && value === undefined) {
    return true
  }

  if (schema?.anyOf !== undefined) {
    return schema.anyOf.some((inner) => check(inner, value))
  }

  if (schema?.type === 'array') {
    return Array.isArray(value) && value.every((item) => check(schema.items, item))
  }

  if (schema?.type === 'boolean') {
    return typeof value === 'boolean'
  }

  if (schema?.type === 'null') {
    return value === null
  }

  if (schema?.type === 'number') {
    return typeof value === 'number'
  }

  if (schema?.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }

    const required = schema.required ?? []
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
      Object.entries(schema.properties ?? {}).every(([key, propertySchema]) => check(propertySchema, value[key]))
  }

  if (schema?.type === 'string') {
    return typeof value === 'string'
  }

  return true
}

function errors (schema, value) {
  if (check(schema, value)) {
    return []
  }

  return [
    {
      keyword: 'type',
      schemaPath: '#',
      instancePath: '',
      params: { type: schema?.type ?? 'unknown' },
      message: 'invalid value'
    }
  ]
}

const Schema = {
  Compile (schema) {
    return {
      Check: (value) => check(schema, value),
      Errors: (value) => {
        const validationErrors = errors(schema, value)
        return [validationErrors.length === 0, validationErrors]
      }
    }
  }
}

module.exports = Schema
module.exports.default = Schema
