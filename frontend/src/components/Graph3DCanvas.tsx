import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type { Edge, Topic, Zone } from "../lib/types";
import {
  hashString,
  type GraphCanvasThemeMode,
  type TopicAnchorPoint,
} from "./graphCanvasCore";
import { buildGraph3DLayout, type Graph3DLayout, type GraphPoint3D } from "./graph3dCore";

type LabelVisual = { sprite: THREE.Sprite; material: THREE.SpriteMaterial };
type ZoneVisual = { mesh: THREE.Mesh; material: THREE.ShaderMaterial; label: LabelVisual; topicIds: Set<string> };
type EdgeRecord = { edge: Edge; colorOffset: number };

type SceneVisuals = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  edgeColorAttribute: THREE.BufferAttribute;
  edgeRecords: EdgeRecord[];
  labels: Map<string, LabelVisual>;
  nodeIds: string[];
  nodeMesh: THREE.InstancedMesh;
  positions: Map<string, THREE.Vector3>;
  renderer: THREE.WebGLRenderer;
  rootRings: Map<string, THREE.SpriteMaterial>;
  selectedRing: THREE.Sprite;
  selectedRingMaterial: THREE.SpriteMaterial;
  zoneVisuals: Map<string, ZoneVisual>;
};

function plainLabel(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
    .replace(/\$+/g, "")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function createLabelVisual(text: string, themeMode: GraphCanvasThemeMode, accent = false): LabelVisual {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const label = plainLabel(text).slice(0, 76) || "Untitled";
  const fontSize = accent ? 27 : 23;
  context.font = `${accent ? 650 : 520} ${fontSize}px Manrope, Inter, sans-serif`;
  const measuredWidth = Math.ceil(context.measureText(label).width);
  canvas.width = Math.min(640, Math.max(128, measuredWidth + 36));
  canvas.height = accent ? 58 : 52;
  context.font = `${accent ? 650 : 520} ${fontSize}px Manrope, Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = themeMode === "dark"
    ? (accent ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.78)")
    : (accent ? "rgba(45,43,40,0.96)" : "rgba(45,43,40,0.78)");
  context.fillText(label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: accent ? 0.64 : 0.34,
  });
  const sprite = new THREE.Sprite(material);
  const width = Math.min(58, Math.max(18, canvas.width / 10));
  sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
  return { sprite, material };
}

function createRingTexture(themeMode: GraphCanvasThemeMode): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.strokeStyle = themeMode === "dark" ? "rgba(174,180,182,0.64)" : "rgba(83,70,58,0.58)";
  context.lineWidth = 3;
  context.setLineDash([6, 8]);
  context.beginPath();
  context.arc(64, 64, 43, 0, Math.PI * 2);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type ZoneCloudVolume = {
  center: THREE.Vector3;
  scale: THREE.Vector3;
  envelopeRadii: THREE.Vector3;
  rotation: THREE.Quaternion;
};

function createVolumeNoiseTexture(): THREE.Data3DTexture {
  const size = 32;
  const data = new Uint8Array(size * size * size);
  let state = 0x9e3779b9;
  for (let index = 0; index < data.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = state & 0xff;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function covarianceDirection(
  points: THREE.Vector3[],
  center: THREE.Vector3,
  initial: THREE.Vector3,
  excluded?: THREE.Vector3,
): THREE.Vector3 {
  const direction = initial.clone().normalize();
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const next = new THREE.Vector3();
    for (const point of points) {
      const delta = point.clone().sub(center);
      next.addScaledVector(delta, delta.dot(direction));
    }
    if (excluded) next.addScaledVector(excluded, -next.dot(excluded));
    if (next.lengthSq() < 0.000001) break;
    direction.copy(next.normalize());
  }
  return direction;
}

function zonePrincipalAxes(points: THREE.Vector3[], center: THREE.Vector3): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const primary = covarianceDirection(points, center, new THREE.Vector3(1, 0.73, 0.41));
  const secondarySeed = Math.abs(primary.y) < 0.82
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  const secondary = covarianceDirection(points, center, secondarySeed, primary);
  if (secondary.lengthSq() < 0.5) {
    secondary.copy(secondarySeed).addScaledVector(primary, -secondarySeed.dot(primary)).normalize();
  }
  const tertiary = primary.clone().cross(secondary).normalize();
  secondary.copy(tertiary).cross(primary).normalize();
  return [primary, secondary, tertiary];
}

function zoneCloudVolume(
  zone: Zone,
  positions: Map<string, THREE.Vector3>,
): ZoneCloudVolume | null {
  const members = zone.topic_ids.map((topicId) => positions.get(topicId)).filter((point): point is THREE.Vector3 => Boolean(point));
  if (members.length === 0) return null;
  const mean = members.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / members.length);
  const [axisX, axisY, axisZ] = zonePrincipalAxes(members, mean);
  const projected = members.map((point) => {
    const delta = point.clone().sub(mean);
    return new THREE.Vector3(delta.dot(axisX), delta.dot(axisY), delta.dot(axisZ));
  });
  const bounds = new THREE.Box3().setFromPoints(projected);
  const localCenter = bounds.getCenter(new THREE.Vector3());
  const halfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const center = mean.clone()
    .addScaledVector(axisX, localCenter.x)
    .addScaledVector(axisY, localCenter.y)
    .addScaledVector(axisZ, localCenter.z);
  const radius = THREE.MathUtils.clamp(18 + halfSize.length() / Math.max(2.6, Math.cbrt(members.length) * 2.1), 22, 42);
  const envelopeRadii = new THREE.Vector3(
    Math.max(radius, halfSize.x + radius * 0.72),
    Math.max(radius, halfSize.y + radius * 0.72),
    Math.max(radius, halfSize.z + radius * 0.72),
  );
  const centeredProjected = projected.map((point) => point.clone().sub(localCenter));
  const maximumEnvelopeNorm = centeredProjected.reduce((maximum, point) => {
    const normalized = point.clone().divide(envelopeRadii);
    const fourthPowerNorm = Math.pow(
      Math.pow(Math.abs(normalized.x), 4)
        + Math.pow(Math.abs(normalized.y), 4)
        + Math.pow(Math.abs(normalized.z), 4),
      0.25,
    );
    return Math.max(maximum, fourthPowerNorm);
  }, 0);
  if (maximumEnvelopeNorm > 0.82) envelopeRadii.multiplyScalar(maximumEnvelopeNorm / 0.82);
  const scale = envelopeRadii.clone().multiplyScalar(1.3);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axisX, axisY, axisZ));
  return { center, scale, envelopeRadii, rotation };
}

function createZoneMaterial(
  zone: Zone,
  themeMode: GraphCanvasThemeMode,
  cloud: ZoneCloudVolume,
  noiseTexture: THREE.Data3DTexture,
  marchSteps: number,
): THREE.ShaderMaterial {
  const color = new THREE.Color(zone.color || (themeMode === "dark" ? "#6d7d83" : "#a78b74"));
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: themeMode === "dark" ? 0.026 : 0.12 },
      uLightTheme: { value: themeMode === "light" ? 1 : 0 },
      uCameraLocal: { value: new THREE.Vector3() },
      uScale: { value: cloud.scale.clone() },
      uEnvelopeRadii: { value: cloud.envelopeRadii.clone() },
      uTime: { value: 0 },
      uSeed: { value: (hashString(zone.id) % 1000) / 1000 },
      uNoise: { value: noiseTexture },
    },
    vertexShader: `
      out vec3 vLocalPosition;
      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      const int MARCH_STEPS = ${marchSteps};
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uLightTheme;
      uniform vec3 uCameraLocal;
      uniform vec3 uScale;
      uniform vec3 uEnvelopeRadii;
      uniform float uTime;
      uniform float uSeed;
      uniform sampler3D uNoise;
      in vec3 vLocalPosition;
      out vec4 outputColor;

      vec2 hitBox(vec3 origin, vec3 direction) {
        vec3 safeDirection = sign(direction) * max(abs(direction), vec3(0.0001));
        vec3 inverseDirection = 1.0 / safeDirection;
        vec3 nearPlane = (-vec3(1.0) - origin) * inverseDirection;
        vec3 farPlane = (vec3(1.0) - origin) * inverseDirection;
        vec3 smaller = min(nearPlane, farPlane);
        vec3 larger = max(nearPlane, farPlane);
        return vec2(max(max(smaller.x, smaller.y), smaller.z), min(min(larger.x, larger.y), larger.z));
      }

      float cloudNoise(vec3 point) {
        vec3 animatedPoint = point + vec3(uSeed * 3.7, uTime * 0.012, -uTime * 0.008);
        float broad = texture(uNoise, fract(animatedPoint * 0.38)).r;
        float medium = texture(uNoise, fract(animatedPoint * 0.94 + 0.27)).r;
        return broad * 0.66 + medium * 0.34;
      }

      float envelopeDistance(vec3 point) {
        vec3 worldPoint = point * uScale;
        vec3 normalized = abs(worldPoint / uEnvelopeRadii);
        return pow(
          pow(normalized.x, 4.0)
            + pow(normalized.y, 4.0)
            + pow(normalized.z, 4.0),
          0.25
        ) - 1.0;
      }

      float densityAt(vec3 point) {
        float signedDistance = envelopeDistance(point);
        float detail = cloudNoise(point * 2.35);
        float warpedDistance = signedDistance + (detail - 0.5) * 0.22;
        float envelope = smoothstep(0.18, -0.1, warpedDistance);
        float interior = smoothstep(0.02, -0.46, signedDistance);
        float porosity = mix(0.64, 1.0, detail);
        return envelope * mix(porosity, 1.0, interior);
      }

      void main() {
        vec3 rayDirection = normalize(vLocalPosition - uCameraLocal);
        vec2 bounds = hitBox(uCameraLocal, rayDirection);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);
        float stepLength = (bounds.y - bounds.x) / float(MARCH_STEPS);
        vec3 point = uCameraLocal + rayDirection * (bounds.x + stepLength * 0.5);
        float accumulatedAlpha = 0.0;
        float accumulatedDensity = 0.0;
        float accumulatedLight = 0.0;
        float previousDensity = 0.0;
        for (int stepIndex = 0; stepIndex < MARCH_STEPS; stepIndex++) {
          float density = densityAt(point);
          float shapedDensity = smoothstep(0.08, 0.82, density);
          float sampleAlpha = shapedDensity * uOpacity * 0.12;
          float surfaceLight = clamp(0.58 + (density - previousDensity) * 2.4, 0.24, 1.25);
          accumulatedLight += (1.0 - accumulatedAlpha) * sampleAlpha * surfaceLight;
          accumulatedAlpha += (1.0 - accumulatedAlpha) * sampleAlpha;
          accumulatedDensity += density * stepLength;
          previousDensity = density;
          if (accumulatedAlpha > 0.52) break;
          point += rayDirection * stepLength;
        }
        if (accumulatedAlpha < 0.004) discard;
        float directionalLight = accumulatedLight / max(accumulatedAlpha, 0.001);
        float luminance = 0.34 + directionalLight * 0.62 + min(0.18, accumulatedDensity * 0.02);
        vec3 darkThemeColor = uColor * luminance * 0.84;
        vec3 lightThemeColor = uColor * (0.82 + directionalLight * 0.14);
        vec3 shadedColor = mix(darkThemeColor, lightThemeColor, uLightTheme);
        outputColor = vec4(shadedColor, accumulatedAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    glslVersion: THREE.GLSL3,
  });
}

function createNodeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      varying vec3 vObjectPosition;
      void main() {
        vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
        vec4 viewPosition = modelViewMatrix * instancePosition;
        vColor = instanceColor;
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        vObjectPosition = position;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      varying vec3 vObjectPosition;

      float surfaceGrain(vec3 point) {
        vec3 cell = floor(point * 15.0);
        return fract(sin(dot(cell, vec3(12.9898, 78.233, 41.164))) * 43758.5453);
      }

      void main() {
        vec3 viewDirection = normalize(vViewDirection);
        vec3 normal = normalize(vNormal);
        vec3 lightDirection = normalize(vec3(0.38, 0.72, 0.58));
        float diffuse = max(dot(normal, lightDirection) * 0.5 + 0.5, 0.0);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
        vec3 halfDirection = normalize(lightDirection + viewDirection);
        float roughSpecular = pow(max(dot(normal, halfDirection), 0.0), 7.0);
        float grain = mix(0.94, 1.035, surfaceGrain(vObjectPosition));
        vec3 surface = vColor * (0.3 + diffuse * 0.54) * grain;
        vec3 rim = vColor * fresnel * 0.24;
        vec3 finalColor = surface + rim + vColor * roughSpecular * 0.07;
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    depthWrite: true,
    transparent: false,
    toneMapped: false,
  });
}

function graphPointToVector(point: GraphPoint3D): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function projectedAnchor(position: THREE.Vector3, state: SceneVisuals): TopicAnchorPoint | null {
  const projected = position.clone().project(state.camera);
  if (projected.z < -1 || projected.z > 1) return null;
  const width = state.renderer.domElement.clientWidth;
  const height = state.renderer.domElement.clientHeight;
  const x = (projected.x * 0.5 + 0.5) * width;
  const y = (-projected.y * 0.5 + 0.5) * height;
  return { x, y, side: x > width * 0.56 ? "left" : "right" };
}

function applyAppearance(args: {
  state: SceneVisuals;
  topics: Topic[];
  edges: Edge[];
  zones: Zone[];
  selectedTopicId: string | null;
  rootIds: Set<string>;
  pathNodeIds: Set<string>;
  pathEdgeIds: Set<string>;
  frontierEdgeIds: Set<string>;
  themeMode: GraphCanvasThemeMode;
}): void {
  const { state, topics, zones, selectedTopicId, rootIds, pathNodeIds, pathEdgeIds, frontierEdgeIds, themeMode } = args;
  const matrix = new THREE.Matrix4();
  topics.forEach((topic, index) => {
    const position = state.positions.get(topic.id)!;
    const selected = topic.id === selectedTopicId;
    const onPath = pathNodeIds.has(topic.id);
    const scale = selected ? 1.62 : onPath ? 1.24 : rootIds.has(topic.id) ? 1.12 : 1;
    matrix.compose(position, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    state.nodeMesh.setMatrixAt(index, matrix);
    const active = selected || onPath;
    const nodeColor = themeMode === "dark"
      ? new THREE.Color(active ? 0xeff1f2 : 0x5e6468)
      : new THREE.Color(active ? 0x6f665e : 0xb3a99e);
    state.nodeMesh.setColorAt(index, nodeColor);
    const label = state.labels.get(topic.id);
    if (label) {
      label.material.opacity = selected ? 1 : onPath ? 0.9 : rootIds.has(topic.id) ? 0.82 : (themeMode === "dark" ? 0.64 : 0.52);
      const baseWidth = Number(label.sprite.userData.baseWidth ?? label.sprite.scale.x);
      const baseHeight = Number(label.sprite.userData.baseHeight ?? label.sprite.scale.y);
      const labelScale = selected ? 1.22 : onPath ? 1.08 : 1;
      label.sprite.scale.set(baseWidth * labelScale, baseHeight * labelScale, 1);
    }
  });
  state.nodeMesh.instanceMatrix.needsUpdate = true;
  if (state.nodeMesh.instanceColor) state.nodeMesh.instanceColor.needsUpdate = true;

  for (const [topicId, material] of state.rootRings) {
    material.opacity = topicId === selectedTopicId ? 0 : 0.22;
  }
  const selectedPosition = selectedTopicId ? state.positions.get(selectedTopicId) : null;
  state.selectedRing.visible = Boolean(selectedPosition);
  if (selectedPosition) state.selectedRing.position.copy(selectedPosition);
  state.selectedRingMaterial.opacity = selectedPosition ? 0.92 : 0;

  const colors = state.edgeColorAttribute.array as Float32Array;
  const baseColor = themeMode === "dark" ? new THREE.Color(0x5e6468) : new THREE.Color(0xb3a99e);
  const pathColor = themeMode === "dark"
    ? new THREE.Color().setRGB(1.35, 1.38, 1.4)
    : new THREE.Color(0x6f665e);
  const frontierColor = new THREE.Color(themeMode === "dark" ? 0xd8c071 : 0xa97f25);
  for (const record of state.edgeRecords) {
    const color = pathEdgeIds.has(record.edge.id) ? pathColor : frontierEdgeIds.has(record.edge.id) ? frontierColor : baseColor;
    colors.set([color.r, color.g, color.b, color.r, color.g, color.b], record.colorOffset);
  }
  state.edgeColorAttribute.needsUpdate = true;

  const selectedZoneIds = new Set(
    zones
      .filter((zone) => selectedTopicId && zone.topic_ids.some((topicId) => topicId === selectedTopicId || pathNodeIds.has(topicId)))
      .map((zone) => zone.id),
  );
  for (const [zoneId, visual] of state.zoneVisuals) {
    const highlighted = selectedZoneIds.has(zoneId);
    visual.material.uniforms["uOpacity"].value = highlighted
      ? (themeMode === "dark" ? 0.06 : 0.23)
      : (themeMode === "dark" ? 0.026 : 0.12);
    visual.label.material.opacity = highlighted ? 0.58 : (selectedTopicId ? 0.1 : 0.18);
  }

}

export function Graph3DCanvas({
  topics,
  edges,
  zones,
  selectedTopicId,
  rootIds,
  pathNodeIds,
  pathEdgeIds,
  frontierEdgeIds,
  onSelectTopic,
  onSelectedTopicAnchorChange,
  themeMode,
}: {
  topics: Topic[];
  edges: Edge[];
  zones: Zone[];
  selectedTopicId: string | null;
  rootIds: Set<string>;
  pathNodeIds: Set<string>;
  pathEdgeIds: Set<string>;
  frontierEdgeIds: Set<string>;
  onSelectTopic: (topicId: string | null, anchor: TopicAnchorPoint | null) => void;
  onSelectedTopicAnchorChange: (anchor: TopicAnchorPoint | null) => void;
  themeMode: GraphCanvasThemeMode;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneVisuals | null>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const onSelectTopicRef = useRef(onSelectTopic);
  const onSelectedTopicAnchorChangeRef = useRef(onSelectedTopicAnchorChange);
  const selectedTopicIdRef = useRef(selectedTopicId);
  const pathNodeIdsRef = useRef(pathNodeIds);
  const layout = useMemo<Graph3DLayout>(() => buildGraph3DLayout(topics, edges, zones), [topics, edges, zones]);
  const rootSignature = useMemo(() => [...rootIds].sort().join("|"), [rootIds]);
  onSelectTopicRef.current = onSelectTopic;
  onSelectedTopicAnchorChangeRef.current = onSelectedTopicAnchorChange;
  selectedTopicIdRef.current = selectedTopicId;
  pathNodeIdsRef.current = pathNodeIds;

  useEffect(() => {
    const mount = mountRef.current;
    const container = containerRef.current;
    if (!mount || !container) return;

    const scene = new THREE.Scene();
    const highDensityGraph = topics.length >= 160;
    const background = themeMode === "dark" ? new THREE.Color(0x000000) : new THREE.Color(0xf7f7f4);
    scene.background = background;
    scene.fog = new THREE.FogExp2(background, themeMode === "dark" ? 0.00108 : 0.00085);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(background, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, highDensityGraph ? 1.32 : 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = themeMode === "dark" ? 1.18 : 0.94;
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      themeMode === "dark" ? 0.72 : 0.18,
      0.48,
      1.05,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.rotateSpeed = 0.58;
    controls.panSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    controls.enablePan = false;
    controls.minDistance = 18;
    controls.maxDistance = Math.max(1600, layout.radius * 10);

    const positions = new Map([...layout.positions].map(([id, point]) => [id, graphPointToVector(point)]));
    const center = graphPointToVector(layout.center);
    const fitView = (): void => {
      const fitDistance = Math.max(180, layout.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.08);
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0.72, 0.42, 1).normalize().multiplyScalar(fitDistance));
      camera.near = Math.max(0.1, fitDistance / 1000);
      camera.far = Math.max(4000, fitDistance * 12);
      camera.updateProjectionMatrix();
      controls.update();
    };
    fitView();
    resetViewRef.current = fitView;

    scene.add(new THREE.HemisphereLight(themeMode === "dark" ? 0xffffff : 0xfff5e9, themeMode === "dark" ? 0x111111 : 0xb9aa99, 1.35));
    const keyLight = new THREE.PointLight(themeMode === "dark" ? 0xdceeff : 0xffd9bf, 18, layout.radius * 5 + 800, 1.6);
    keyLight.position.copy(center).add(new THREE.Vector3(layout.radius, layout.radius * 1.2, layout.radius));
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(themeMode === "dark" ? 0xa5ffd6 : 0xffefe2, 9, layout.radius * 4 + 600, 1.8);
    fillLight.position.copy(center).add(new THREE.Vector3(-layout.radius, -layout.radius * 0.4, -layout.radius));
    scene.add(fillLight);

    const spatialGrid = new THREE.GridHelper(
      Math.max(900, layout.radius * 5.5),
      72,
      themeMode === "dark" ? 0x566064 : 0xb9aea3,
      themeMode === "dark" ? 0x30373a : 0xd8d0c7,
    );
    spatialGrid.position.copy(center).add(new THREE.Vector3(0, -layout.radius * 0.68, 0));
    const gridMaterials = Array.isArray(spatialGrid.material) ? spatialGrid.material : [spatialGrid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = themeMode === "dark" ? 0.11 : 0.16;
      material.depthWrite = false;
    });
    scene.add(spatialGrid);

    const volumeNoiseTexture = createVolumeNoiseTexture();
    const zoneVisuals = new Map<string, ZoneVisual>();
    for (const zone of zones) {
      const cloud = zoneCloudVolume(zone, positions);
      if (!cloud) continue;
      const geometry = new THREE.BoxGeometry(2, 2, 2);
      const material = createZoneMaterial(
        zone,
        themeMode,
        cloud,
        volumeNoiseTexture,
        topics.length >= 220 ? 24 : topics.length >= 100 ? 30 : 38,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(cloud.center);
      mesh.quaternion.copy(cloud.rotation);
      mesh.scale.copy(cloud.scale);
      mesh.renderOrder = -3;
      scene.add(mesh);
      const memberPositions = zone.topic_ids.map((topicId) => positions.get(topicId)).filter((point): point is THREE.Vector3 => Boolean(point));
      const zoneCenter = memberPositions.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / memberPositions.length);
      const label = createLabelVisual(zone.title, themeMode, true);
      label.sprite.position.copy(zoneCenter).add(new THREE.Vector3(0, Math.min(...cloud.envelopeRadii.toArray()) * 0.24, 0));
      label.material.opacity = 0.3;
      label.sprite.renderOrder = 3;
      scene.add(label.sprite);
      zoneVisuals.set(zone.id, { mesh, material, label, topicIds: new Set(zone.topic_ids) });
    }

    const edgePositions: number[] = [];
    const edgeColors: number[] = [];
    const edgeRecords: EdgeRecord[] = [];
    const baseEdgeColor = themeMode === "dark" ? new THREE.Color(0x5e6468) : new THREE.Color(0xb3a99e);
    for (const edge of edges) {
      const source = positions.get(edge.source_topic_id);
      const target = positions.get(edge.target_topic_id);
      if (!source || !target) continue;
      edgePositions.push(source.x, source.y, source.z, target.x, target.y, target.z);
      const colorOffset = edgeColors.length;
      edgeColors.push(baseEdgeColor.r, baseEdgeColor.g, baseEdgeColor.b, baseEdgeColor.r, baseEdgeColor.g, baseEdgeColor.b);
      edgeRecords.push({ edge, colorOffset });
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeColorAttribute = new THREE.Float32BufferAttribute(edgeColors, 3);
    edgeGeometry.setAttribute("color", edgeColorAttribute);
    const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: themeMode === "dark" ? 0.62 : 0.42, depthWrite: false });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.renderOrder = 0;
    scene.add(edgeLines);

    const nodeGeometry = new THREE.IcosahedronGeometry(2.15, 3);
    const nodeMaterial = createNodeMaterial();
    const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, topics.length);
    nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodeMesh.renderOrder = 2;
    scene.add(nodeMesh);

    const labels = new Map<string, LabelVisual>();
    const labelRankById = new Map(
      [...topics]
        .sort((left, right) => {
          const rootDifference = Number(!rootIds.has(left.id)) - Number(!rootIds.has(right.id));
          if (rootDifference !== 0) return rootDifference;
          if (left.level !== right.level) return left.level - right.level;
          return hashString(left.id) - hashString(right.id);
        })
        .map((topic, index) => [topic.id, index]),
    );
    topics.forEach((topic) => {
      const position = positions.get(topic.id)!;
      const label = createLabelVisual(topic.title, themeMode);
      label.sprite.position.copy(position).add(new THREE.Vector3(0, 7.2, 0));
      label.sprite.userData.baseWidth = label.sprite.scale.x;
      label.sprite.userData.baseHeight = label.sprite.scale.y;
      label.sprite.userData.lodRank = labelRankById.get(topic.id) ?? topics.length;
      label.sprite.renderOrder = 4;
      labels.set(topic.id, label);
      scene.add(label.sprite);
    });

    const ringTexture = createRingTexture(themeMode);
    const rootRings = new Map<string, THREE.SpriteMaterial>();
    for (const topicId of rootIds) {
      const position = positions.get(topicId);
      if (!position) continue;
      const material = new THREE.SpriteMaterial({ map: ringTexture, transparent: true, depthWrite: false, opacity: 0.22 });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(13, 13, 1);
      sprite.renderOrder = 5;
      rootRings.set(topicId, material);
      scene.add(sprite);
    }
    const selectedRingMaterial = new THREE.SpriteMaterial({ map: ringTexture, transparent: true, depthWrite: false, opacity: 0.92 });
    const selectedRing = new THREE.Sprite(selectedRingMaterial);
    selectedRing.scale.set(18, 18, 1);
    selectedRing.visible = false;
    selectedRing.renderOrder = 6;
    scene.add(selectedRing);

    const state: SceneVisuals = {
      camera,
      controls,
      edgeColorAttribute,
      edgeRecords,
      labels,
      nodeIds: topics.map((topic) => topic.id),
      nodeMesh,
      positions,
      renderer,
      rootRings,
      selectedRing,
      selectedRingMaterial,
      zoneVisuals,
    };
    sceneRef.current = state;
    applyAppearance({ state, topics, edges, zones, selectedTopicId: selectedTopicIdRef.current, rootIds, pathNodeIds, pathEdgeIds, frontierEdgeIds, themeMode });

    const resize = (): void => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    let pointerPressed = false;
    let rightMouseLook = false;
    let lookPointer = { x: 0, y: 0 };
    const raycastNode = (event: PointerEvent | MouseEvent): number | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(nodeMesh, false)[0];
      return hit?.instanceId ?? null;
    };
    const handlePointerDown = (event: PointerEvent): void => {
      container.focus({ preventScroll: true });
      if (event.button === 2) {
        event.preventDefault();
        rightMouseLook = true;
        lookPointer = { x: event.clientX, y: event.clientY };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        renderer.domElement.style.cursor = "crosshair";
        if (hoverRef.current) hoverRef.current.hidden = true;
        return;
      }
      if (event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY };
      pointerPressed = true;
    };
    const handlePointerUp = (event: PointerEvent): void => {
      if (event.button === 2 || rightMouseLook) {
        rightMouseLook = false;
        controls.enabled = true;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        renderer.domElement.style.cursor = "grab";
        return;
      }
      if (event.button !== 0) return;
      pointerPressed = false;
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const instanceId = raycastNode(event);
      if (instanceId == null) {
        onSelectTopicRef.current(null, null);
        return;
      }
      const topicId = state.nodeIds[instanceId];
      const position = state.positions.get(topicId)!;
      onSelectTopicRef.current(topicId, projectedAnchor(position, state));
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (rightMouseLook) {
        const deltaX = event.clientX - lookPointer.x;
        const deltaY = event.clientY - lookPointer.y;
        lookPointer = { x: event.clientX, y: event.clientY };
        const distance = Math.max(1, camera.position.distanceTo(controls.target));
        const direction = controls.target.clone().sub(camera.position).normalize();
        direction.applyAxisAngle(camera.up, -deltaX * 0.0032);
        const rightAxis = direction.clone().cross(camera.up).normalize();
        const pitchedDirection = direction.clone().applyAxisAngle(rightAxis, -deltaY * 0.0032);
        if (Math.abs(pitchedDirection.dot(camera.up)) < 0.97) direction.copy(pitchedDirection);
        controls.target.copy(camera.position).add(direction.multiplyScalar(distance));
        return;
      }
      if (pointerPressed) return;
      const instanceId = raycastNode(event);
      renderer.domElement.style.cursor = instanceId == null ? "grab" : "pointer";
      const hover = hoverRef.current;
      if (!hover) return;
      if (instanceId == null) {
        hover.hidden = true;
        return;
      }
      hover.hidden = false;
      hover.textContent = topics[instanceId]?.title ?? "";
      const rect = container.getBoundingClientRect();
      hover.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 14}px)`;
    };
    const handleContextMenu = (event: MouseEvent): void => event.preventDefault();
    const handlePointerCancel = (event: PointerEvent): void => {
      pointerPressed = false;
      rightMouseLook = false;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const handleDoubleClick = (event: MouseEvent): void => {
      const instanceId = raycastNode(event);
      if (instanceId == null) return;
      const position = state.positions.get(state.nodeIds[instanceId])!;
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(position);
      camera.position.copy(position).add(direction.multiplyScalar(Math.max(72, layout.radius * 0.18)));
      controls.update();
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);
    renderer.domElement.addEventListener("dblclick", handleDoubleClick);

    const pressedKeys = new Set<string>();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        pressedKeys.add(event.code);
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent): void => { pressedKeys.delete(event.code); };
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("keyup", handleKeyUp);

    let previousFrameTime = performance.now();
    const animationStartedAt = previousFrameTime;
    let frame = 0;
    let animationFrame = 0;
    let lastAnchor: TopicAnchorPoint | null = null;
    const animate = (): void => {
      animationFrame = window.requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - previousFrameTime) / 1000, 0.05);
      previousFrameTime = now;
      const speed = Math.max(26, layout.radius * 0.18) * (pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight") ? 2.8 : 1) * delta;
      const forward = controls.target.clone().sub(camera.position).normalize();
      const right = forward.clone().cross(camera.up).normalize();
      const movement = new THREE.Vector3();
      if (pressedKeys.has("KeyW")) movement.add(forward);
      if (pressedKeys.has("KeyS")) movement.sub(forward);
      if (pressedKeys.has("KeyD")) movement.add(right);
      if (pressedKeys.has("KeyA")) movement.sub(right);
      if (pressedKeys.has("KeyE")) movement.add(camera.up);
      if (pressedKeys.has("KeyQ")) movement.sub(camera.up);
      if (movement.lengthSq() > 0) {
        movement.normalize().multiplyScalar(speed);
        camera.position.add(movement);
        controls.target.add(movement);
      }
      controls.update(delta);
      for (const visual of zoneVisuals.values()) {
        visual.material.uniforms["uCameraLocal"].value.copy(camera.position);
        visual.mesh.worldToLocal(visual.material.uniforms["uCameraLocal"].value);
        visual.material.uniforms["uTime"].value = (now - animationStartedAt) / 1000;
      }
      composer.render();
      frame += 1;
      if (frame % 6 === 0 && highDensityGraph) {
        const distanceRatio = camera.position.distanceTo(controls.target) / Math.max(layout.radius, 1);
        const labelLimit = distanceRatio > 2.05 ? 48 : distanceRatio > 1.2 ? 96 : 180;
        for (const [topicId, label] of labels) {
          label.sprite.visible = topicId === selectedTopicIdRef.current
            || pathNodeIdsRef.current.has(topicId)
            || Number(label.sprite.userData.lodRank ?? topics.length) < labelLimit;
        }
      }
      if (frame % 5 === 0 && selectedTopicIdRef.current) {
        const selectedPosition = positions.get(selectedTopicIdRef.current);
        const anchor = selectedPosition ? projectedAnchor(selectedPosition, state) : null;
        const anchorChanged = anchor
          ? !lastAnchor || Math.abs(anchor.x - lastAnchor.x) > 1 || Math.abs(anchor.y - lastAnchor.y) > 1 || anchor.side !== lastAnchor.side
          : Boolean(lastAnchor);
        if (anchorChanged) {
          lastAnchor = anchor;
          onSelectedTopicAnchorChangeRef.current(anchor);
        }
      }
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("keyup", handleKeyUp);
      controls.dispose();
      composer.dispose();
      volumeNoiseTexture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      onSelectedTopicAnchorChangeRef.current(null);
    };
  }, [layout, themeMode, topics, edges, zones, rootSignature]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    applyAppearance({ state, topics, edges, zones, selectedTopicId, rootIds, pathNodeIds, pathEdgeIds, frontierEdgeIds, themeMode });
    const selectedPosition = selectedTopicId ? state.positions.get(selectedTopicId) : null;
    onSelectedTopicAnchorChange(selectedPosition ? projectedAnchor(selectedPosition, state) : null);
  }, [edges, frontierEdgeIds, onSelectedTopicAnchorChange, pathEdgeIds, pathNodeIds, rootIds, selectedTopicId, themeMode, topics, zones]);

  return (
    <div ref={containerRef} className="graph3dSurface" tabIndex={0} aria-label="Interactive 3D knowledge graph">
      <div ref={mountRef} className="graph3dMount" />
      <div ref={hoverRef} className="graph3dHoverLabel" hidden />
      <div className="graph3dNavigationHint">
        <span>Hold RMB to look · WASD to fly · Q/E vertical · Shift to boost</span>
        <button type="button" onClick={() => resetViewRef.current()}>Reset view</button>
      </div>
    </div>
  );
}
