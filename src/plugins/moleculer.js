'use strict'

const analyticsSampler = require('../analytics_sampler')

function createWrapBrokerCall (tracer, config) {
  return function wrapBrokerCall (brokerCall) {
    return function brokerCallWithTrace (actionName, params, opts) {
      const scope = tracer.scope()
      const childOf = scope.active()
      const span = tracer.startSpan('broker.call', {
        childOf,
        tags: {
          'span.kind': 'client',
          'resource.name': actionName,
          'span.type': 'moleculer',
          'params': params
        }
      })

      span.setTag('service.name', actionName.split('.')[0])

      analyticsSampler.sample(span, config.analytics)

      return scope.bind(brokerCall, span).call(this, actionName, params, opts)
        .then(res => finish(span, res))
        .catch(err => finish(span, null, err))
    }
  }
}

function finish (span, data, err) {
  if (err) {
    span.addTags({
      'error.type': err.name,
      'error.msg': err.message,
      'error.stack': err.stack
    })
  }

  span.finish()
  if (err) {
    throw err
  }

  return data
}

module.exports = [
  {
    name: 'moleculer',
    versions: ['>=0.13.0'],
    patch (moleculer, tracer, config) {
      this.wrap(moleculer.ServiceBroker.prototype, 'call', createWrapBrokerCall(tracer, config))
    },
    unpatch (moleculer) {
      this.unwrap(moleculer.ServiceBroker.prototype, 'call')
    }
  }
]
