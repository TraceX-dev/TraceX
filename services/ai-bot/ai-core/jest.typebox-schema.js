function check (schema, value) {
  if (schema?.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }

    const required = schema.required ?? Object.keys(schema.properties ?? {})
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
      Object.entries(schema.properties ?? {}).every(([key, propertySchema]) => check(propertySchema, value[key]))
  }

  if (schema?.type === 'string') {
    return typeof value === 'string'
  }

  if (schema?.type === 'number') {
    return typeof value === 'number'
  }

  return true
}

function errors (schema, value) {
  if (schema?.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [
        {
          keyword: 'type',
          schemaPath: '#',
          instancePath: '',
          params: { type: 'object' },
          message: 'must be object'
        }
      ]
    }

    const required = schema.required ?? Object.keys(schema.properties ?? {})
    const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
    if (missing.length > 0) {
      return [
        {
          keyword: 'required',
          schemaPath: '#',
          instancePath: '',
          params: { requiredProperties: missing },
          message: `must have required properties ${missing.join(', ')}`
        }
      ]
    }

    return Object.entries(schema.properties ?? {}).flatMap(([key, propertySchema]) => {
      return errors(propertySchema, value[key]).map((error) => ({
        ...error,
        schemaPath: `#/properties/${key}${error.schemaPath === '#' ? '' : error.schemaPath.slice(1)}`,
        instancePath: `/${key}${error.instancePath}`
      }))
    })
  }

  if (schema?.type === 'string' && typeof value !== 'string') {
    return [
      {
        keyword: 'type',
        schemaPath: '#',
        instancePath: '',
        params: { type: 'string' },
        message: 'must be string'
      }
    ]
  }

  if (schema?.type === 'number' && typeof value !== 'number') {
    return [
      {
        keyword: 'type',
        schemaPath: '#',
        instancePath: '',
        params: { type: 'number' },
        message: 'must be number'
      }
    ]
  }

  return []
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
