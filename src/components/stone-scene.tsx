"use client";

import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import type { WebGLRenderer } from "three";
import { advanceRotation, createStoneGeometry, degreesToRadians } from "@/lib/stone-geometry";
import StoneFallback from "./stone-fallback";

export type StoneRenderer = "webgl" | "svg";
export interface StoneSceneProps {
  angle: number;
  seed: number;
  theme: "light" | "dark";
  quality: "auto" | "lite";
  onRendererChange?: (renderer: StoneRenderer) => void;
}

type FallbackReason = "loading" | "lite" | "low-power" | "webgl-unavailable" | "context-lost" | "render-error";
type ThreeModule = typeof import("three");
interface SceneController {
  setAngle: (angle: number) => void;
  setTheme: (theme: StoneSceneProps["theme"]) => void;
  dispose: () => void;
}
interface DeviceCapabilities {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
}

export function shouldUseLightweightRenderer(
  quality: StoneSceneProps["quality"],
  device: DeviceCapabilities,
): boolean {
  return quality === "lite" || device.saveData === true ||
    (typeof device.deviceMemory === "number" && device.deviceMemory > 0 && device.deviceMemory <= 2) ||
    (typeof device.hardwareConcurrency === "number" && device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2);
}

// All color variation, mineral seams and small-scale relief are evaluated in
// object space. They turn with the stone and never require a texture download.
const stoneShader = /* glsl */ `
  varying vec3 vStonePosition;
  uniform float uStoneSeed;

  float stoneHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.11369, 0.13787));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float stoneNoise3(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(stoneHash(cell), stoneHash(cell + vec3(1,0,0)), f.x),
          mix(stoneHash(cell + vec3(0,1,0)), stoneHash(cell + vec3(1,1,0)), f.x), f.y),
      mix(mix(stoneHash(cell + vec3(0,0,1)), stoneHash(cell + vec3(1,0,1)), f.x),
          mix(stoneHash(cell + vec3(0,1,1)), stoneHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
  }

  float stoneLayers(vec3 p) {
    return stoneNoise3(p) * 0.58 + stoneNoise3(p * 2.07 + 4.2) * 0.28 +
      stoneNoise3(p * 4.13 + 8.7) * 0.14;
  }
`;

function createStoneMaterial(three: ThreeModule, seed: number) {
  const material = new three.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.91,
    metalness: 0.025,
  });
  material.customProgramCacheKey = () => "stone-viewer-procedural-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStoneSeed = { value: (seed >>> 0) % 8192 / 512 };
    shader.vertexShader = `varying vec3 vStonePosition;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvStonePosition = position;",
    );
    shader.fragmentShader = `${stoneShader}\n${shader.fragmentShader}`
      .replace("#include <map_fragment>", /* glsl */ `
        #include <map_fragment>
        vec3 stoneP = vStonePosition + vec3(uStoneSeed, uStoneSeed * 0.37, uStoneSeed * 0.71);
        float stoneCloud = stoneLayers(stoneP * 2.7);
        float stoneMedium = stoneNoise3(stoneP * 29.0);
        float stoneGrainFootprint = max(length(dFdx(stoneP)), length(dFdy(stoneP))) * 108.0;
        float stoneGrainVisibility = 1.0 - smoothstep(0.75, 1.65, stoneGrainFootprint);
        float stoneGrain = mix(0.5, stoneNoise3(stoneP * 108.0), stoneGrainVisibility);
        float stoneQuartz = smoothstep(0.73, 0.92, stoneGrain);
        float stoneSeamDistance = abs(vStonePosition.y + vStonePosition.x * 0.28 - 0.16
          + (stoneNoise3(stoneP * 2.1) - 0.5) * 0.26);
        float stoneSeam = 1.0 - smoothstep(0.008, 0.033, stoneSeamDistance);
        vec3 stoneColor = mix(vec3(0.145, 0.160, 0.146), vec3(0.305, 0.313, 0.283), stoneCloud);
        stoneColor *= 0.82 + stoneMedium * 0.23 + stoneGrain * 0.12;
        stoneColor = mix(stoneColor, vec3(0.37, 0.375, 0.335), stoneSeam * 0.34);
        stoneColor += vec3(0.052, 0.050, 0.043) * stoneQuartz;
        stoneColor *= 0.83 + smoothstep(-0.85, 0.5, vStonePosition.y) * 0.17;
        diffuseColor.rgb *= stoneColor;
        float stoneWeathering = 0.65 + stoneCloud * 0.55;
        float stoneHeight = (stoneMedium * 0.008 + stoneGrain * 0.003) * stoneWeathering + stoneSeam * 0.0015;
      `)
      .replace("#include <roughnessmap_fragment>", /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(0.88 + stoneGrain * 0.10 - stoneQuartz * 0.05, 0.82, 1.0);
      `)
      .replace("#include <normal_fragment_maps>", /* glsl */ `
        #include <normal_fragment_maps>
        vec3 stoneDx = dFdx(-vViewPosition);
        vec3 stoneDy = dFdy(-vViewPosition);
        vec3 stoneTangentX = cross(stoneDy, normal);
        vec3 stoneTangentY = cross(normal, stoneDx);
        float stoneDet = dot(stoneDx, stoneTangentX);
        vec3 stoneGradient = dFdx(stoneHeight) * stoneTangentX + dFdy(stoneHeight) * stoneTangentY;
        normal = normalize(max(abs(stoneDet), 0.00000001) * normal - sign(stoneDet) * stoneGradient);
      `);
  };
  return material;
}

function createWebGLScene(
  three: ThreeModule,
  options: {
    canvas: HTMLCanvasElement;
    context: WebGL2RenderingContext;
    host: HTMLDivElement;
    marker: HTMLDivElement;
    seed: number;
    angle: number;
    theme: StoneSceneProps["theme"];
    onFailure: (reason: FallbackReason) => void;
  },
): SceneController {
  const { canvas, context, host, marker } = options;
  const resources: Array<{ dispose: () => void }> = [];
  const listeners: Array<() => void> = [];
  let renderer: WebGLRenderer | undefined;
  let stopped = false;
  let frame = 0;

  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const removeListener of listeners) removeListener();
    for (const resource of resources.reverse()) resource.dispose();
    if (renderer) {
      renderer.dispose();
      // Also releases Three's internal placeholder textures / scratch framebuffers.
      if (!context.isContextLost()) renderer.forceContextLoss();
    }
  };

  try {
    renderer = new three.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      stencil: false,
    });
    const activeRenderer = renderer;
    activeRenderer.setClearColor(0x000000, 0);
    activeRenderer.outputColorSpace = three.SRGBColorSpace;
    activeRenderer.toneMapping = three.ACESFilmicToneMapping;
    activeRenderer.toneMappingExposure = 1.04;
    let shaderFailed = false;
    activeRenderer.debug.onShaderError = () => { shaderFailed = true; };

    const scene = new three.Scene();
    const camera = new three.OrthographicCamera(-3, 3, 2, -2, 0.1, 30);
    camera.position.set(0, 1.28, 7);
    camera.lookAt(0, -0.04, 0);

    const geometry = createStoneGeometry(three, options.seed);
    resources.push(geometry);
    const material = createStoneMaterial(three, options.seed);
    resources.push(material);
    const stone = new three.Mesh(geometry, material);
    stone.position.y = 0.1;
    stone.rotation.y = degreesToRadians(options.angle);
    scene.add(stone);

    const sky = new three.HemisphereLight(0xf0efdf, 0x303c30, 1.65);
    const key = new three.DirectionalLight(0xfff3df, 3.1);
    key.position.set(-3.5, 5, 4);
    const fill = new three.DirectionalLight(0xdde7ea, 0.55);
    fill.position.set(4, 1.7, 2);
    const rim = new three.DirectionalLight(0xf6f4e9, 1.9);
    rim.position.set(1, 3.5, -4);
    scene.add(sky, key, fill, rim);

    // Analytic contact shadow: one small draw call, no shadow map or texture.
    const shadowGeometry = new three.PlaneGeometry(5.2, 3.7);
    resources.push(shadowGeometry);
    const shadowMaterial = new three.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: 0.29 },
        uColor: { value: new three.Color(0x3f483b) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vShadowUv;
        void main() {
          vShadowUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vShadowUv;
        uniform float uOpacity;
        uniform vec3 uColor;
        void main() {
          float distanceFromCenter = length((vShadowUv - 0.5) * 2.0);
          float shadow = exp(-distanceFromCenter * distanceFromCenter * 5.8);
          shadow *= 1.0 - smoothstep(0.68, 1.0, distanceFromCenter);
          gl_FragColor = vec4(uColor, shadow * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    resources.push(shadowMaterial);
    const shadow = new three.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.09, -1.05, -0.03);
    scene.add(shadow);

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionPreference.matches;
    let inView = true;
    let targetAngle = options.angle;
    let renderedAngle = options.angle;
    let elapsed = 0;
    let lastFrame = performance.now();
    let lastDraw = lastFrame;
    const frameInterval = 1000 / 30;

    const applyTheme = (theme: StoneSceneProps["theme"]) => {
      const dark = theme === "dark";
      sky.intensity = dark ? 1.5 : 1.65;
      key.intensity = dark ? 3.45 : 3.1;
      rim.intensity = dark ? 2.7 : 1.9;
      shadowMaterial.uniforms.uOpacity.value = dark ? 0.55 : 0.29;
      shadowMaterial.uniforms.uColor.value.set(dark ? 0x000000 : 0x3f483b);
    };
    applyTheme(options.theme);

    const fail = (reason: FallbackReason) => {
      if (stopped) return;
      dispose();
      options.onFailure(reason);
    };
    const canRender = () => !stopped && !document.hidden && inView;
    const schedule = () => {
      if (canRender() && frame === 0) frame = requestAnimationFrame(tick);
    };
    const draw = (deltaSeconds: number) => {
      renderedAngle = advanceRotation(renderedAngle, targetAngle, deltaSeconds, reducedMotion);
      if (!reducedMotion) elapsed += deltaSeconds;
      stone.position.y = reducedMotion ? 0.1 : 0.1 + Math.sin(elapsed * 0.52) * 0.022;
      stone.rotation.y = degreesToRadians(renderedAngle);
      activeRenderer.render(scene, camera);
      if (shaderFailed) throw new Error("Procedural material could not be compiled.");
      marker.dataset.renderedAngle = String(renderedAngle);
      marker.dataset.renderedYaw = String(stone.rotation.y);
    };

    function tick(now: number) {
      frame = 0;
      if (!canRender()) return;
      const sinceFrame = now - lastFrame;
      if (sinceFrame < frameInterval) {
        schedule();
        return;
      }
      lastFrame = now - (sinceFrame % frameInterval);
      const deltaSeconds = Math.min((now - lastDraw) / 1000, 0.1);
      lastDraw = now;
      try {
        draw(deltaSeconds);
      } catch {
        fail("render-error");
        return;
      }
      if (!reducedMotion || renderedAngle !== targetAngle) schedule();
    }

    const resize = () => {
      if (stopped) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const stoneWidth = geometry.boundingBox!.max.x - geometry.boundingBox!.min.x;
      const desiredWidth = Math.max(1, Math.min(width * 0.8, height * 1.03, 380));
      const halfWidth = (stoneWidth * width / desiredWidth) / 2;
      const halfHeight = halfWidth * height / width;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      activeRenderer.setSize(width, height, false);
      schedule();
    };

    const onVisibilityChange = () => {
      if (!canRender()) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        lastDraw = performance.now();
        lastFrame = lastDraw - frameInterval;
        schedule();
      }
    };
    const onMotionChange = () => {
      reducedMotion = motionPreference.matches;
      schedule();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      fail("context-lost");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionPreference.addEventListener("change", onMotionChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    listeners.push(
      () => document.removeEventListener("visibilitychange", onVisibilityChange),
      () => motionPreference.removeEventListener("change", onMotionChange),
      () => canvas.removeEventListener("webglcontextlost", onContextLost),
    );

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        try { resize(); } catch { fail("render-error"); }
      });
      observer.observe(host);
      listeners.push(() => observer.disconnect());
    } else {
      window.addEventListener("resize", resize);
      listeners.push(() => window.removeEventListener("resize", resize));
    }
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        onVisibilityChange();
      }, { rootMargin: "100px" });
      observer.observe(host);
      listeners.push(() => observer.disconnect());
    }

    resize();
    activeRenderer.compile(scene, camera);
    if (shaderFailed) throw new Error("Procedural material could not be compiled.");
    draw(0);
    if (!reducedMotion) schedule();

    return {
      setAngle(nextAngle) { targetAngle = nextAngle; schedule(); },
      setTheme(theme) { applyTheme(theme); schedule(); },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

function StoneScene({ angle, seed, theme, quality, onRendererChange }: StoneSceneProps) {
  const safeAngle = Number.isFinite(angle) ? angle : 0;
  const markerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [status, setStatus] = useState<{
    renderer: StoneRenderer;
    reason?: FallbackReason;
    seed: number;
    quality: StoneSceneProps["quality"];
  }>({ renderer: "svg", reason: "loading", seed, quality });
  const current = status.seed === seed && status.quality === quality;
  const renderer = current ? status.renderer : "svg";
  const reason = current ? status.reason : "loading";

  const readCurrentProps = useEffectEvent(() => ({ angle: safeAngle, theme }));
  const reportRenderer = useEffectEvent((nextRenderer: StoneRenderer, fallbackReason?: FallbackReason) => {
    setStatus({ renderer: nextRenderer, reason: fallbackReason, seed, quality });
    onRendererChange?.(nextRenderer);
  });

  useEffect(() => {
    const marker = markerRef.current;
    const host = canvasHostRef.current;
    if (!marker || !host) return;
    let cancelled = false;
    let controller: SceneController | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let context: WebGL2RenderingContext | null = null;

    const releaseContext = () => {
      if (context && !context.isContextLost()) context.getExtension("WEBGL_lose_context")?.loseContext();
      context = null;
    };
    const activateFallback = (fallbackReason: FallbackReason) => {
      if (cancelled) return;
      controller?.dispose();
      controller = null;
      controllerRef.current = null;
      canvas?.remove();
      releaseContext();
      marker.dataset.renderedAngle = String(readCurrentProps().angle);
      delete marker.dataset.renderedYaw;
      reportRenderer("svg", fallbackReason);
    };

    const initialize = async () => {
      const device = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean };
      };
      if (shouldUseLightweightRenderer(quality, {
        deviceMemory: device.deviceMemory,
        hardwareConcurrency: device.hardwareConcurrency,
        saveData: device.connection?.saveData,
      })) {
        activateFallback(quality === "lite" ? "lite" : "low-power");
        return;
      }

      try {
        canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none;";
        context = canvas.getContext("webgl2", {
          alpha: true, antialias: true, powerPreference: "low-power", stencil: false,
        });
        if (!context) { activateFallback("webgl-unavailable"); return; }
        // This is the only runtime Three import. Lite/unsupported devices never fetch it.
        const three = await import("three");
        if (cancelled) { releaseContext(); return; }
        const props = readCurrentProps();
        controller = createWebGLScene(three, {
          canvas, context, host, marker, seed,
          angle: props.angle,
          theme: props.theme,
          onFailure: activateFallback,
        });
        controllerRef.current = controller;
        host.appendChild(canvas);
        reportRenderer("webgl");
      } catch {
        activateFallback("render-error");
      }
    };

    const setupFrame = requestAnimationFrame(() => { void initialize(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(setupFrame);
      controller?.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      canvas?.remove();
      releaseContext();
    };
  }, [quality, seed]);

  useEffect(() => {
    controllerRef.current?.setAngle(safeAngle);
    if (renderer === "svg" && markerRef.current) {
      markerRef.current.dataset.renderedAngle = String(safeAngle);
    }
  }, [safeAngle, renderer]);

  useEffect(() => { controllerRef.current?.setTheme(theme); }, [theme]);

  return (
    <div
      ref={markerRef}
      data-testid="stone-scene"
      data-renderer={renderer}
      data-angle={safeAngle}
      data-fallback-reason={renderer === "svg" ? reason : undefined}
      role="img"
      aria-label={`コードで生成された石。累計${safeAngle}度。${renderer === "svg" ? "軽量表示では平面上の回転で表現しています。" : "ボタンを押すと1度だけ回転します。"}`}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 180 }}
    >
      <div
        ref={canvasHostRef}
        style={{ position: "absolute", inset: 0, opacity: renderer === "webgl" ? 1 : 0, pointerEvents: "none" }}
      />
      {renderer === "svg" ? (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <StoneFallback angle={safeAngle} seed={seed} theme={theme} />
        </div>
      ) : null}
      {renderer === "svg" && reason !== "loading" ? (
        <span style={{ position: "absolute", top: 28, width: "100%", textAlign: "center", fontSize: 10, letterSpacing: ".06em", color: theme === "dark" ? "#afb4a7" : "#6d7466" }}>
          軽量表示 · 平面上で1度ずつ回転
        </span>
      ) : null}
    </div>
  );
}

export default memo(StoneScene);
