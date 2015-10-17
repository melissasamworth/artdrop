import {designsRef, layersRef, layerImagesRef,
colorPalettesRef, surfacesRef,
surfaceOptionsRef, tagsRef, ordersRef} from 'state/firebaseRefs'
import reactor from 'state/reactor'
import getters from 'state/getters'
var Immutable = require('nuclear-js').Immutable
var {Map, List} = Immutable
var RSVP = require('RSVP')

var exports = {}

exports.nonOptionKeys = ['id', 'printingPrice', 'salePrice', 'units',
  'vendorId', 'height', 'width', 'depth', 'printingImageWidth', 'printingImageHeight']

function setSizeOnSurfaceOption(option) {
  var units = option.get('units')
  var height = option.get('height')
  var width = option.get('width')
  var depth = option.get('depth')
  if (!(height && width)) { return option }
  if (depth) {
    return option.set('size: height, width, depth', `${height} x ${width} x ${depth} ${units}`)
  }
  return option.set('size: height, width', `${height} x ${width} ${units}`)
}

exports.dispatchHelper = function() {
  var args = arguments
  var interval = setInterval(() => {
    if (!reactor.__isDispatching) {
      clearInterval(interval)
      reactor.dispatch.apply(reactor, args)
    }
  }, 100)
}

exports.defaultSurfaceOptionIdForSurface = (surfaceObj) => {
  if (Array.isArray(surfaceObj.options)) {
    return surfaceObj.options[0].id
  }
  return Object.keys(surfaceObj.options)[0]
}

var designPropsToIds = (design) => {
  var layerIds = design.get('layers').map(l => l.get('id'))
  var surfaceId = design.get('surface') ? design.getIn(['surface', 'id']) : null
  var surfaceOptionId = design.get('surfaceOption') ? design.getIn(['surfaceOption', 'id']) : null
  return surfaceId ? design.withMutations(d => {
   return d.set('layers', layerIds).set('surface', surfaceId).set('surfaceOption', surfaceOptionId)
  })
  : design.set('layers', layerIds)
}

function nestedHydrateLayer(layerId) {
  return hydrateLayer(layerId).then(layer => {
    return hydrateLayerImage(layer.selectedLayerImage).then(layerImage => {
      layerImage.id = layer.selectedLayerImage
      reactor.dispatch('addLayerImage', layerImage)
      layer.selectedLayerImage = layerImage
      layer.id = layerId
      layer.tags = populateTags(layer)
      return hydrateColorPalette(layer.colorPalette).then(colorPalette => {
        colorPalette.id = layer.colorPalette
        layer.colorPalette = colorPalette
        reactor.dispatch('addColorPalette', colorPalette)
        return layer
      })
    })
  })
}

function hydrateSurfaceOption(surfaceOptionId) {
  return (
    hydrateObj(surfaceOptionsRef, surfaceOptionId)
    .then(surfaceOption => {
      surfaceOption.id = surfaceOptionId
      return setSizeOnSurfaceOption(Map(surfaceOption)).toJS()
    })
  )
}

function addIdsToData(data) {
  return Object.keys(data).map(id => {
    var obj = data[id]
    obj.id = id
    return obj
  })
}

function hydrateTagsIfMissing() {
  return new Promise((resolve, reject) => {
    var existingTags = reactor.evaluate(getters.tags)
    if (existingTags.count() > 0) { resolve() }
    else {
      tagsRef.once('value', snapshot => {
        var data = snapshot.val()
        var dataToDispatch = addIdsToData(data)
        reactor.dispatch('addManyTags', dataToDispatch)
        resolve()
      })
    }
  })
}

function populateTags(obj) {
  if (obj.hasOwnProperty('tags')) {
    var tagsMap = reactor.evaluate(['tags'])
    return List(Object.keys(obj.tags).map(id => {
      return tagsMap.get(id)
    }))
  }
  return List()
}

exports.hydrateDesign = (design) => {
  return hydrateTagsIfMissing().then(() => {
    var layers = design.layers.map(nestedHydrateLayer)
    return RSVP.all(layers).then(layers => {
      design.layers = layers;
      return hydrateSurface(design.surface)
    }).then(surface => {
      return (
        hydrateSurfaceOptionsForSurface(surface)
        .then(surfaceOptions => {
          surface.id = design.surface
          surface.options = surfaceOptions
          design.surface = surface
          design.tags = populateTags(design)
          design.surfaceOption = surface.options.filter(o => o.id === design.surfaceOption)[0]
          reactor.dispatch('addSurface', surface)
          reactor.dispatch('addDesign', design)
        })
      )
    }).catch(e => console.error("Got Error: ", e))
  })
}

function hydrateSurfaceOptionsForSurface (surface) {
  return RSVP.all(Object.keys(surface.options).map(hydrateSurfaceOption))
}

exports.hydrateSurfaceOptionsForSurface = hydrateSurfaceOptionsForSurface

var hydrateObj = (ref, id) => {
  return new RSVP.Promise(resolve => {
    ref.child(id).once('value', o => resolve(o.val()))
  })
}

var hydrateAndDispatchData = (dbRef, dispatchMsg, currentState) => {
  dbRef.once('value', snapshot => {
    var data = snapshot.val()
    var dataToDispatch = addIdsToData(data)
    reactor.dispatch(dispatchMsg, dataToDispatch)
  })
}

var hydrateLayer = hydrateObj.bind(null, layersRef)
var hydrateLayerImage = hydrateObj.bind(null, layerImagesRef)
var hydrateColorPalette = hydrateObj.bind(null, colorPalettesRef)
var hydrateSurface = hydrateObj.bind(null, surfacesRef)

var persistWithRef = (firebaseRef, id, obj) => {
  if (DEBUG) {
    console.log(`Saving to firebase ref ${firebaseRef} at id: ${id}.`)
  }
  firebaseRef.child(id).update(obj)
}

var persistNewLayer = (layer) => {
  var l = layer.toJS()
  l.colorPalette = l.colorPalette.id
  l.selectedLayerImage = l.selectedLayerImage.id
  layersRef.child(l.id).set(l)
}

exports.hydrateAndDispatchLayerImages = hydrateAndDispatchData.bind(null, layerImagesRef, 'addManyLayerImages')
exports.hydrateAndDispatchSurfaces = hydrateAndDispatchData.bind(null, surfacesRef, 'addManySurfaces')
exports.hydrateAndDispatchTags = hydrateAndDispatchData.bind(null, tagsRef, 'addManyTags')
exports.hydrateAndDispatchColorPalettes = hydrateAndDispatchData.bind(null, colorPalettesRef, 'addManyColorPalettes')

exports.hydrateColorPalette = hydrateColorPalette
exports.hydrateSurface = hydrateSurface
exports.hydrateObj = hydrateObj

exports.persistNewDesign = (design) => {
  design.get('layers').forEach(persistNewLayer)
  var firebaseDesign = designPropsToIds(design)
  return new RSVP.Promise((resolve, reject) => {
    designsRef.child(design.get('id')).set(firebaseDesign.toJS(), (err) => {
      if (err) { reject() }
      else     { resolve() }
    })
  })
}

exports.updateLayerOfDesign = (layer, design, updateFn) => {
  var layers = design.get('layers')
  var i = layers.findIndex(l => l.get('id') === layer.get('id'))
  return design.set('layers', layers.update(i, v => updateFn(v)))
}

exports.idListToFirebaseObj = (list) => {
  var retVal = {}
  list.forEach(i => retVal[i] = true)
  return retVal
}

exports.persistAndCreateNewOrder = (orderData) => {
  return new RSVP.Promise((resolve, reject) => {
    var newOrderRef = ordersRef.push(orderData, (err) => {
      if (err) { reject() }
      else     { resolve(newOrderRef.key()) }
    })
  })
}

exports.persistWithRef = persistWithRef
exports.persistDesign = persistWithRef.bind(null, designsRef)
exports.persistLayer = persistWithRef.bind(null, layersRef)
exports.persistSurface = persistWithRef.bind(null, surfacesRef)
exports.persistTag = persistWithRef.bind(null, tagsRef)
export default exports
