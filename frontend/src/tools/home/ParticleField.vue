<script setup lang="ts">
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ParticleQuality } from '@/types'
import { particleProfileFor } from './particleProfile'

interface FocusTarget {
  toolId: string
  color: string
}

const props = defineProps<{
  stage: 'hero' | 'workbench'
  quality: Exclude<ParticleQuality, 'off'>
  reducedMotion: boolean
}>()

const host = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let starSystem: THREE.Group | null = null
let spherePoints: THREE.Points | null = null
let innerPoints: THREE.Points | null = null
let satellite: THREE.Group | null = null
let orbitGroup: THREE.Group | null = null
let sphereMaterial: THREE.PointsMaterial | null = null
let innerMaterial: THREE.PointsMaterial | null = null
let satelliteMaterial: THREE.PointsMaterial | null = null
let orbitMaterials: THREE.LineDashedMaterial[] = []
let resizeObserver: ResizeObserver | null = null
let frameId = 0
let lastTime = 0
let pointerInside = false
let pointerX = 0
let pointerY = 0
let targetSphereOpacity = 0.82
let targetInnerOpacity = 0.28
let targetOrbitOpacity = 0.2
let targetSatelliteOpacity = 0.9
let targetSystemX = 0
let targetSystemY = 0.5
let targetSystemScale = 0.84
let satelliteAngle = Math.PI * 1.04
let disposables: Array<THREE.BufferGeometry | THREE.Material> = []
const activeColor = new THREE.Color('#79bfff')
const neutralSatelliteColor = new THREE.Color('#79bfff')

function seededRandom(seed: number): () => number {
  let value = seed % 2147483647
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function createSphereGeometry(count: number, radius: number, seed: number, inner = false): THREE.BufferGeometry {
  const random = seededRandom(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const lightDirection = new THREE.Vector3(-0.82, 0.24, 0.52).normalize()
  const base = new THREE.Color('#536f89')
  const white = new THREE.Color('#f5fbff')
  const dim = new THREE.Color('#172635')
  const normal = new THREE.Vector3()
  const color = new THREE.Color()

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const y = 1 - (index / Math.max(1, count - 1)) * 2
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = Math.PI * (3 - Math.sqrt(5)) * index + random() * 0.045
    const shellRadius = inner ? radius * Math.cbrt(random()) * 0.94 : radius * (0.985 + random() * 0.03)
    const x = Math.cos(theta) * ringRadius
    const z = Math.sin(theta) * ringRadius
    positions[offset] = x * shellRadius
    positions[offset + 1] = y * shellRadius
    positions[offset + 2] = z * shellRadius
    normal.set(x, y, z)
    const diffuse = Math.max(0, normal.dot(lightDirection))
    const rim = Math.pow(1 - Math.abs(z), 3.2)
    const sparkle = random() > 0.935 ? 0.42 : random() * 0.12
    const intensity = inner ? 0.12 + Math.max(0, z) * 0.16 + sparkle * 0.2 : Math.min(1, 0.17 + diffuse * 0.68 + rim * 0.38 + sparkle)
    color.copy(inner ? dim : base).lerp(white, intensity)
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function createOrbit(radius: number, verticalScale: number, phase: number): THREE.LineLoop {
  const count = 260
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    const offset = index * 3
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = Math.sin(angle) * verticalScale + Math.sin(angle * 3 + phase) * 0.035
    positions[offset + 2] = Math.sin(angle) * radius * 0.28
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineDashedMaterial({
    color: '#7db4e1', transparent: true, opacity: targetOrbitOpacity, dashSize: 0.055, gapSize: 0.095,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const line = new THREE.LineLoop(geometry, material)
  line.computeLineDistances()
  line.rotation.z = phase * 0.05
  disposables.push(geometry, material)
  orbitMaterials.push(material)
  return line
}

function updateStage(stage: 'hero' | 'workbench'): void {
  if (stage === 'hero') {
    targetSystemX = 0
    targetSystemY = 0.52
    targetSystemScale = 0.84
    targetSphereOpacity = 0.82
    targetInnerOpacity = 0.22
    targetOrbitOpacity = 0.2
    targetSatelliteOpacity = 0.9
  } else {
    targetSystemX = Math.min(5.5, Math.max(2.3, (camera?.aspect ?? 1.6) * 1.58))
    targetSystemY = 0.76
    targetSystemScale = 0.52
    targetSphereOpacity = 0.16
    targetInnerOpacity = 0.042
    targetOrbitOpacity = 0.055
    targetSatelliteOpacity = 0.38
  }
  if (host.value) host.value.dataset.stage = stage
}

function scheduleRender(): void {
  if (!frameId && !document.hidden && !props.reducedMotion) frameId = window.requestAnimationFrame(render)
}

function resize(): void {
  if (!host.value || !renderer || !camera) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (props.stage === 'workbench') targetSystemX = Math.min(5.5, Math.max(2.3, camera.aspect * 1.58))
  if (props.reducedMotion) render(performance.now())
}

function render(time: number): void {
  frameId = 0
  if (!renderer || !scene || !camera || !starSystem || !spherePoints || !innerPoints || !satellite || !satelliteMaterial || !sphereMaterial || !innerMaterial || !orbitGroup) return
  const profile = particleProfileFor(props.quality)
  if (!props.reducedMotion && profile.frameIntervalMs && lastTime && time - lastTime < profile.frameIntervalMs) {
    scheduleRender()
    return
  }
  const elapsed = time * 0.001
  const deltaSeconds = lastTime ? Math.min(0.032, (time - lastTime) / 1000) : 0.016
  lastTime = time
  const stageSmoothing = props.reducedMotion ? 1 : 1 - Math.pow(0.0004, deltaSeconds)
  const pointerSmoothing = props.reducedMotion ? 1 : 1 - Math.pow(0.006, deltaSeconds)
  starSystem.position.x += (targetSystemX - starSystem.position.x) * stageSmoothing
  starSystem.position.y += (targetSystemY - starSystem.position.y) * stageSmoothing
  const nextScale = starSystem.scale.x + (targetSystemScale - starSystem.scale.x) * stageSmoothing
  starSystem.scale.setScalar(nextScale * (props.reducedMotion ? 1 : 1 + Math.sin(elapsed * 0.92) * 0.012))
  sphereMaterial.opacity += (targetSphereOpacity - sphereMaterial.opacity) * stageSmoothing
  innerMaterial.opacity += (targetInnerOpacity - innerMaterial.opacity) * stageSmoothing
  orbitMaterials.forEach((material) => { material.opacity += (targetOrbitOpacity - material.opacity) * stageSmoothing })
  satelliteMaterial.opacity += (targetSatelliteOpacity - satelliteMaterial.opacity) * stageSmoothing
  satelliteMaterial.color.lerp(activeColor, pointerSmoothing)

  if (!props.reducedMotion) {
    const targetRotationY = pointerInside ? pointerX * 0.12 : Math.sin(elapsed * 0.18) * 0.025
    const targetRotationX = pointerInside ? -pointerY * 0.07 : Math.cos(elapsed * 0.14) * 0.012
    starSystem.rotation.y += (targetRotationY - starSystem.rotation.y) * pointerSmoothing
    starSystem.rotation.x += (targetRotationX - starSystem.rotation.x) * pointerSmoothing
    spherePoints.rotation.y = elapsed * 0.035
    innerPoints.rotation.y = -elapsed * 0.021
    orbitGroup.rotation.y = elapsed * 0.028
    satelliteAngle += deltaSeconds * 0.16
  }
  satellite.position.set(Math.cos(satelliteAngle) * 3.25, Math.sin(satelliteAngle * 1.07) * 0.47, Math.sin(satelliteAngle) * 0.9)
  satellite.rotation.y = -satelliteAngle * 0.45
  renderer.render(scene, camera)
  if (host.value) {
    host.value.dataset.ready = 'true'
    host.value.dataset.static = String(props.reducedMotion)
  }
  scheduleRender()
}

function onPointerMove(event: PointerEvent): void {
  if (!host.value || props.reducedMotion) return
  const rect = host.value.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    pointerInside = false
    return
  }
  pointerInside = true
  pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointerY = ((event.clientY - rect.top) / rect.height) * 2 - 1
}

function onPointerLeave(): void { pointerInside = false }

function focus(target: FocusTarget): void {
  activeColor.set(target.color)
  targetSatelliteOpacity = 0.82
  if (host.value) host.value.dataset.activeTool = target.toolId
  if (props.reducedMotion) render(performance.now())
}

function release(): void {
  activeColor.copy(neutralSatelliteColor)
  targetSatelliteOpacity = props.stage === 'hero' ? 0.9 : 0.38
  host.value?.removeAttribute('data-active-tool')
  if (props.reducedMotion) render(performance.now())
}

function disposeScene(): void {
  window.cancelAnimationFrame(frameId)
  frameId = 0
  lastTime = 0
  disposables.forEach((item) => item.dispose())
  disposables = []
  orbitMaterials = []
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
  scene = null
  camera = null
  starSystem = null
  spherePoints = null
  innerPoints = null
  satellite = null
  orbitGroup = null
  sphereMaterial = null
  innerMaterial = null
  satelliteMaterial = null
}

function initializeScene(): void {
  if (!host.value) return
  const profile = particleProfileFor(props.quality)
  host.value.dataset.ready = 'false'
  host.value.dataset.quality = props.quality
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: profile.powerPreference, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatioMax))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.className = 'particle-canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.value.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#05070a')
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40)
  camera.position.z = 7
  starSystem = new THREE.Group()
  sphereMaterial = new THREE.PointsMaterial({ size: 0.019, sizeAttenuation: true, transparent: true, opacity: targetSphereOpacity, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const sphereGeometry = createSphereGeometry(profile.outerCount, 2.08, 7419)
  spherePoints = new THREE.Points(sphereGeometry, sphereMaterial)
  innerMaterial = new THREE.PointsMaterial({ size: 0.014, sizeAttenuation: true, transparent: true, opacity: targetInnerOpacity, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const innerGeometry = createSphereGeometry(profile.innerCount, 2.02, 2817, true)
  innerPoints = new THREE.Points(innerGeometry, innerMaterial)
  orbitGroup = new THREE.Group()
  orbitGroup.add(createOrbit(2.72, 0.31, 0.4), createOrbit(2.96, 0.42, 2.1), createOrbit(3.28, 0.54, 4.2))
  satellite = new THREE.Group()
  satelliteMaterial = new THREE.PointsMaterial({ size: 0.022, sizeAttenuation: true, transparent: true, opacity: targetSatelliteOpacity, vertexColors: false, color: neutralSatelliteColor, depthWrite: false, blending: THREE.AdditiveBlending })
  const satelliteGeometry = createSphereGeometry(profile.satelliteCount, 0.32, 919)
  satellite.add(new THREE.Points(satelliteGeometry, satelliteMaterial))
  disposables.push(sphereGeometry, sphereMaterial, innerGeometry, innerMaterial, satelliteGeometry, satelliteMaterial)
  starSystem.add(innerPoints, spherePoints, orbitGroup, satellite)
  scene.add(starSystem)
  updateStage(props.stage)
  starSystem.position.set(targetSystemX, targetSystemY, 0)
  starSystem.scale.setScalar(targetSystemScale)
  resize()
  render(performance.now())
}

function onVisibilityChange(): void {
  window.cancelAnimationFrame(frameId)
  frameId = 0
  if (document.hidden) return
  lastTime = 0
  if (props.reducedMotion) render(performance.now())
  else scheduleRender()
}

watch(() => props.stage, (stage) => {
  updateStage(stage)
  if (props.reducedMotion) render(performance.now())
})
watch(() => props.quality, () => {
  disposeScene()
  initializeScene()
})
watch(() => props.reducedMotion, (reduced) => {
  pointerInside = false
  window.cancelAnimationFrame(frameId)
  frameId = 0
  lastTime = 0
  if (reduced) render(performance.now())
  else scheduleRender()
})

onMounted(() => {
  if (!host.value) return
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerleave', onPointerLeave)
  initializeScene()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerleave', onPointerLeave)
  resizeObserver?.disconnect()
  disposeScene()
})

defineExpose({ focus, release })
</script>

<template>
  <div ref="host" class="particle-field" data-ready="false" :data-stage="stage" :data-quality="quality" />
</template>
