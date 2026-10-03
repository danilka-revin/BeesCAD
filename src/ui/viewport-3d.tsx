// Оптимизированный 3D-вьюпорт BeesCAD на базе Three.js.
// Ключевые решения для слабых ПК:
// 1. Рендер строго по требованию (on-demand): в покое цикл requestAnimationFrame НЕ крутится (0% CPU/GPU).
// 2. Учёт профиля производительности (src/perf.ts): DPR потолок (1.0/1.5/2.0), MSAA только в high,
//    автоматический замер длительности кадра noteFrame(ms).
// 3. Честный аппаратный разрез (Section Plane) через localClippingEnabled,
//    интерактивный выбор тел кликом (Raycaster) и 3D-рулетка измерений между точками.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type {
  CadDocument,
  EvaluatedBody,
  EvaluatedScene,
  PlaneId,
  ToolId,
} from '../cad/types';
import { getMaterial } from '../cad/types';
import { IconCube3D } from './icons';
import { getCanvasDpr, getPerfConfig, noteFrame, subscribePerf } from '../perf';

export type ViewStyle = 'shaded_edges' | 'shaded' | 'wireframe' | 'xray';
export type CameraPreset = 'iso' | 'top' | 'front' | 'right' | 'left' | 'back';

export interface MeasurePoint {
  pos: [number, number, number];
  bodyName?: string;
}

interface ViewportProps {
  doc: CadDocument;
  scene: EvaluatedScene;
  selectedFeatureId: string | null;
  selectedBodyId: string | null;
  activeSketchId: string | null;
  tool: ToolId;
  viewStyle: ViewStyle;
  showGrid: boolean;
  showPlanes: boolean;
  cameraPresetReq: { preset: CameraPreset; seq: number };
  fitReq: number;
  theme: 'dark' | 'light';
  measurePoints: MeasurePoint[];
  onSelectBody: (bodyId: string | null, featureId: string | null) => void;
  onAddMeasurePoint: (pt: MeasurePoint) => void;
  onCursor3D: (pos: [number, number, number]) => void;
}

export function Viewport3D({
  doc,
  scene,
  selectedFeatureId,
  selectedBodyId,
  activeSketchId,
  tool,
  viewStyle,
  showGrid,
  showPlanes,
  cameraPresetReq,
  fitReq,
  theme,
  measurePoints,
  onSelectBody,
  onAddMeasurePoint,
  onCursor3D,
}: ViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const callbacksRef = useRef({ onSelectBody, onAddMeasurePoint, onCursor3D });
  callbacksRef.current = { onSelectBody, onAddMeasurePoint, onCursor3D };

  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    threeScene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    bodiesGroup: THREE.Group;
    sketchesGroup: THREE.Group;
    helpersGroup: THREE.Group;
    measureGroup: THREE.Group;
    clipPlane: THREE.Plane;
    sph: { theta: number; phi: number; radius: number };
    target: THREE.Vector3;
    requestRender: () => void;
    fitToScene: (bboxCenter: [number, number, number], bboxSize: [number, number, number]) => void;
    setPresetView: (preset: CameraPreset) => void;
  } | null>(null);

  const toolRef = useRef<ToolId>(tool);
  toolRef.current = tool;

  // Инициализация WebGL-контекста (пересоздаётся только при смене флага antialias3d)
  const antialias = getPerfConfig().antialias3d;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const perf = getPerfConfig();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: perf.antialias3d,
        powerPreference: perf.profile === 'low' ? 'low-power' : 'default',
        alpha: false,
      });
      setWebglError(null);
    } catch {
      setWebglError('WebGL недоступен в этом браузере. Включите аппаратное ускорение или откройте BeesCAD в современном браузере.');
      return;
    }

    renderer.setPixelRatio(getCanvasDpr());
    renderer.localClippingEnabled = true;
    renderer.domElement.className = 'viewport-canvas';
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(theme === 'light' ? 0xe9edf3 : 0x0b0d11);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 8000);
    const sph = { theta: Math.PI * 0.25, phi: Math.PI * 0.34, radius: 175 };
    const target = new THREE.Vector3(0, 12, 0);

    // Освещение сцены: мягкий полусферический свет + два направленных источника для читаемости граней
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.85);
    hemi.position.set(0, 300, 0);
    threeScene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(140, 240, 160);
    threeScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.42);
    rimLight.position.set(-160, -90, -140);
    threeScene.add(rimLight);

    const bodiesGroup = new THREE.Group();
    const sketchesGroup = new THREE.Group();
    const helpersGroup = new THREE.Group();
    const measureGroup = new THREE.Group();
    threeScene.add(helpersGroup);
    threeScene.add(bodiesGroup);
    threeScene.add(sketchesGroup);
    threeScene.add(measureGroup);

    const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

    let rafId = 0;
    const syncCamera = () => {
      const sinP = Math.sin(sph.phi);
      camera.position.set(
        target.x + sph.radius * sinP * Math.sin(sph.theta),
        target.y + sph.radius * Math.cos(sph.phi),
        target.z + sph.radius * sinP * Math.cos(sph.theta),
      );
      camera.lookAt(target);
    };

    const renderNow = () => {
      rafId = 0;
      const t0 = performance.now();
      syncCamera();
      renderer.render(threeScene, camera);
      noteFrame(performance.now() - t0);
    };

    const requestRender = () => {
      if (!rafId) rafId = requestAnimationFrame(renderNow);
    };

    const fitToScene = (center: [number, number, number], size: [number, number, number]) => {
      target.set(center[0], center[1], center[2]);
      const span = Math.max(40, size[0], size[1], size[2]);
      sph.radius = Math.max(45, span * 2.05);
      requestRender();
    };

    const setPresetView = (preset: CameraPreset) => {
      switch (preset) {
        case 'iso':
          sph.theta = Math.PI * 0.25;
          sph.phi = Math.PI * 0.34;
          break;
        case 'front':
          sph.theta = 0;
          sph.phi = Math.PI * 0.49;
          break;
        case 'back':
          sph.theta = Math.PI;
          sph.phi = Math.PI * 0.49;
          break;
        case 'right':
          sph.theta = Math.PI * 0.5;
          sph.phi = Math.PI * 0.49;
          break;
        case 'left':
          sph.theta = -Math.PI * 0.5;
          sph.phi = Math.PI * 0.49;
          break;
        case 'top':
          sph.theta = 0;
          sph.phi = 0.04;
          break;
      }
      requestRender();
    };

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setPixelRatio(getCanvasDpr());
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const unsubPerf = subscribePerf(resize);

    // Управление мышью: вращение (ЛКМ / ПКМ), панорамирование (СКМ или Shift+ЛКМ), зум (колесо), выбор тела (клик)
    const dom = renderer.domElement;
    let dragMode: 'none' | 'orbit' | 'pan' = 'none';
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundHit = new THREE.Vector3();

    const updateNdc = (e: PointerEvent | MouseEvent) => {
      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const onDown = (e: PointerEvent) => {
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      const pan = e.button === 1 || (e.button === 0 && e.shiftKey);
      dragMode = pan ? 'pan' : 'orbit';
      dom.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (dragMode === 'none') {
        // Обновляем координаты курсора на рабочей плоскости XY без перерисовки WebGL!
        updateNdc(e);
        raycaster.setFromCamera(ndc, camera);
        if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
          callbacksRef.current.onCursor3D([
            Math.round(groundHit.x * 10) / 10,
            Math.round(groundHit.y * 10) / 10,
            Math.round(groundHit.z * 10) / 10,
          ]);
        }
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragMode === 'orbit') {
        sph.theta -= dx * 0.0075;
        sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.0075));
      } else {
        const k = sph.radius * 0.0014;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrix.extractBasis(right, up, new THREE.Vector3());
        target.addScaledVector(right, -dx * k);
        target.addScaledVector(up, dy * k);
      }
      requestRender();
    };

    const onUp = (e: PointerEvent) => {
      const movedDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      dragMode = 'none';
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);

      // Если пользователь кликнул без перетаскивания — выбираем 3D-тело или точку измерения
      if (movedDist < 4 && e.button === 0) {
        updateNdc(e);
        raycaster.setFromCamera(ndc, camera);
        const meshes: THREE.Object3D[] = [];
        bodiesGroup.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) meshes.push(obj);
        });
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const ud = hit.object.userData as { bodyId?: string; featureId?: string; bodyName?: string };
          if (toolRef.current === 'measure') {
            callbacksRef.current.onAddMeasurePoint({
              pos: [
                Math.round(hit.point.x * 100) / 100,
                Math.round(hit.point.y * 100) / 100,
                Math.round(hit.point.z * 100) / 100,
              ],
              bodyName: ud.bodyName,
            });
          } else {
            callbacksRef.current.onSelectBody(ud.bodyId || null, ud.featureId || null);
          }
        } else if (toolRef.current !== 'measure') {
          callbacksRef.current.onSelectBody(null, null);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sph.radius = Math.max(12, Math.min(2500, sph.radius * (e.deltaY > 0 ? 1.11 : 0.9)));
      requestRender();
    };

    const onCtx = (e: Event) => e.preventDefault();

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onCtx);

    stateRef.current = {
      renderer,
      threeScene,
      camera,
      bodiesGroup,
      sketchesGroup,
      helpersGroup,
      measureGroup,
      clipPlane,
      sph,
      target,
      requestRender,
      fitToScene,
      setPresetView,
    };

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unsubPerf();
      ro.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onCtx);
      renderer.dispose();
      stateRef.current = null;
    };
  }, [antialias]);

  // Синхронизация фона сцены с темой (dark / light)
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    st.threeScene.background = new THREE.Color(theme === 'light' ? 0xe9edf3 : 0x0b0d11);
    st.requestRender();
  }, [theme]);

  // Отрисовка координатной сетки, осей X/Y/Z и базовых конструкционных плоскостей XY/XZ/YZ
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;

    while (st.helpersGroup.children.length > 0) {
      const ch = st.helpersGroup.children.pop()!;
      st.helpersGroup.remove(ch);
    }

    if (showGrid) {
      const gridColor1 = theme === 'light' ? 0x94a3b8 : 0x2e3644;
      const gridColor2 = theme === 'light' ? 0xcbd5e1 : 0x1a2029;
      const grid = new THREE.GridHelper(240, 24, gridColor1, gridColor2);
      grid.position.y = -0.02;
      st.helpersGroup.add(grid);

      const axes = new THREE.AxesHelper(45);
      axes.position.set(0, 0.05, 0);
      st.helpersGroup.add(axes);
    }

    if (showPlanes) {
      const planeConfigs: { id: PlaneId; color: number; rot: [number, number, number] }[] = [
        { id: 'XY', color: 0x38bdf8, rot: [-Math.PI * 0.5, 0, 0] },
        { id: 'XZ', color: 0x34d399, rot: [0, 0, 0] },
        { id: 'YZ', color: 0xfbbf24, rot: [0, Math.PI * 0.5, 0] },
      ];
      for (const pc of planeConfigs) {
        const g = new THREE.PlaneGeometry(56, 56);
        const m = new THREE.MeshBasicMaterial({
          color: pc.color,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.rotation.set(pc.rot[0], pc.rot[1], pc.rot[2]);
        st.helpersGroup.add(mesh);

        const edgeGeo = new THREE.EdgesGeometry(g);
        const edgeMat = new THREE.LineBasicMaterial({
          color: pc.color,
          transparent: true,
          opacity: 0.35,
        });
        const border = new THREE.LineSegments(edgeGeo, edgeMat);
        border.rotation.set(pc.rot[0], pc.rot[1], pc.rot[2]);
        st.helpersGroup.add(border);
      }
    }

    st.requestRender();
  }, [showGrid, showPlanes, theme, antialias]);

  // Синхронизация твердотельных 3D-тел, эскизов и плоскости сечения
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const obj = grp.children.pop()!;
        obj.traverse((node) => {
          const m = node as THREE.Mesh;
          m.geometry?.dispose?.();
          if (Array.isArray(m.material)) m.material.forEach((mt) => mt.dispose());
          else (m.material as THREE.Material | undefined)?.dispose?.();
        });
      }
    };

    clearGroup(st.bodiesGroup);
    clearGroup(st.sketchesGroup);

    // Плоскость разреза (Section Analysis)
    const sec = doc.section;
    const sign = sec.flip ? 1 : -1;
    if (sec.axis === 'X') st.clipPlane.set(new THREE.Vector3(sign, 0, 0), -sign * sec.offset);
    else if (sec.axis === 'Y') st.clipPlane.set(new THREE.Vector3(0, sign, 0), -sign * sec.offset);
    else st.clipPlane.set(new THREE.Vector3(0, 0, sign), -sign * sec.offset);

    const activeClip = sec.enabled ? [st.clipPlane] : [];

    // Визуальный индикатор плоскости сечения
    if (sec.enabled) {
      const secGeo = new THREE.PlaneGeometry(140, 140);
      const secMat = new THREE.MeshBasicMaterial({
        color: 0xffc233,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const secMesh = new THREE.Mesh(secGeo, secMat);
      if (sec.axis === 'X') {
        secMesh.rotation.y = Math.PI * 0.5;
        secMesh.position.x = sec.offset;
      } else if (sec.axis === 'Y') {
        secMesh.rotation.x = Math.PI * 0.5;
        secMesh.position.y = sec.offset;
      } else {
        secMesh.position.z = sec.offset;
      }
      st.sketchesGroup.add(secMesh);
    }

    // 1. Рендер твердотельных 3D-тел
    const buildBodyObject = (body: EvaluatedBody) => {
      if (!body.visible || body.mesh.positions.length < 9) return;

      const isSelected =
        body.id === selectedBodyId || body.featureId === selectedFeatureId;
      const matSpec = getMaterial(body.materialId);
      const baseColor = new THREE.Color(body.color || matSpec.color);
      if (isSelected) {
        baseColor.lerp(new THREE.Color(0xffc233), 0.38);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(body.mesh.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(body.mesh.normals, 3));

      if (viewStyle !== 'wireframe') {
        const isXray = viewStyle === 'xray';
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          metalness: matSpec.metalness,
          roughness: matSpec.roughness,
          transparent: isXray || body.opacity < 1,
          opacity: isXray ? 0.42 : body.opacity,
          depthWrite: !isXray,
          side: sec.enabled ? THREE.DoubleSide : THREE.FrontSide,
          clippingPlanes: activeClip,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData = {
          bodyId: body.id,
          featureId: body.featureId,
          bodyName: body.name,
        };
        st.bodiesGroup.add(mesh);
      }

      // Отрисовка чётких конструкторских рёбер (в режимах Shaded+Edges, Wireframe, X-Ray)
      if (viewStyle === 'shaded_edges' || viewStyle === 'wireframe' || viewStyle === 'xray') {
        const edgeColor = isSelected
          ? 0xffc233
          : viewStyle === 'wireframe'
            ? baseColor.getHex()
            : theme === 'light'
              ? 0x1e293b
              : 0x090b0f;

        if (body.mesh.edges.length >= 6 && viewStyle !== 'wireframe') {
          const edgeGeom = new THREE.BufferGeometry();
          edgeGeom.setAttribute('position', new THREE.BufferAttribute(body.mesh.edges, 3));
          const edgeMat = new THREE.LineBasicMaterial({
            color: edgeColor,
            transparent: true,
            opacity: isSelected ? 0.95 : 0.65,
            clippingPlanes: activeClip,
          });
          st.bodiesGroup.add(new THREE.LineSegments(edgeGeom, edgeMat));
        } else {
          const wfGeom = new THREE.WireframeGeometry(geom);
          const wfMat = new THREE.LineBasicMaterial({
            color: edgeColor,
            clippingPlanes: activeClip,
          });
          st.bodiesGroup.add(new THREE.LineSegments(wfGeom, wfMat));
        }
      }
    };

    for (const body of scene.bodies) {
      buildBodyObject(body);
    }

    // 2. Рендер 2D-эскизов в 3D-пространстве
    for (const sk of scene.sketches) {
      const isEditing = sk.id === activeSketchId || sk.id === selectedFeatureId;
      if (!sk.visible && !isEditing) continue;
      if (sk.segments3D.length < 6) continue;

      const skGeom = new THREE.BufferGeometry();
      skGeom.setAttribute('position', new THREE.BufferAttribute(sk.segments3D, 3));
      const skMat = new THREE.LineBasicMaterial({
        color: isEditing ? 0xffc233 : 0x38bdf8,
      });
      const lines = new THREE.LineSegments(skGeom, skMat);
      st.sketchesGroup.add(lines);

      if (isEditing) {
        // Подсвечиваем плоскость активного эскиза
        const plGeo = new THREE.PlaneGeometry(110, 110);
        const plMat = new THREE.MeshBasicMaterial({
          color: 0xffc233,
          transparent: true,
          opacity: 0.07,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plMesh = new THREE.Mesh(plGeo, plMat);
        if (sk.plane === 'XY') {
          plMesh.rotation.x = -Math.PI * 0.5;
          plMesh.position.y = sk.planeOffset;
        } else if (sk.plane === 'XZ') {
          plMesh.position.z = sk.planeOffset;
        } else {
          plMesh.rotation.y = Math.PI * 0.5;
          plMesh.position.x = sk.planeOffset;
        }
        st.sketchesGroup.add(plMesh);
      }
    }

    st.requestRender();
  }, [
    scene,
    doc.section,
    selectedBodyId,
    selectedFeatureId,
    activeSketchId,
    viewStyle,
    theme,
    antialias,
  ]);

  // Рендер маркеров и линии измерения (Measure Tool)
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    while (st.measureGroup.children.length > 0) {
      const ch = st.measureGroup.children.pop()!;
      st.measureGroup.remove(ch);
    }

    for (const pt of measurePoints) {
      const g = new THREE.SphereGeometry(1.4, 12, 12);
      const m = new THREE.MeshBasicMaterial({ color: 0xffc233 });
      const s = new THREE.Mesh(g, m);
      s.position.set(pt.pos[0], pt.pos[1], pt.pos[2]);
      st.measureGroup.add(s);
    }

    if (measurePoints.length === 2) {
      const [p1, p2] = measurePoints;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...p1.pos),
        new THREE.Vector3(...p2.pos),
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffc233 });
      st.measureGroup.add(new THREE.Line(lineGeo, lineMat));
    }

    st.requestRender();
  }, [measurePoints]);

  // Обработка переключения пресетов камеры (Изометрия, Сверху, Спереди, Справа и т.д.)
  useEffect(() => {
    if (cameraPresetReq.seq === 0) return;
    stateRef.current?.setPresetView(cameraPresetReq.preset);
  }, [cameraPresetReq]);

  // Вписать всю модель в окно (Fit View)
  useEffect(() => {
    if (fitReq === 0) return;
    stateRef.current?.fitToScene(scene.overallBbox.center, scene.overallBbox.size);
  }, [fitReq, scene.overallBbox]);

  return (
    <div ref={hostRef} className="viewport-stage">
      {webglError && <div className="webgl-error"><IconCube3D /><b>3D-вьюпорт недоступен</b><span>{webglError}</span><small>Попробуйте режим «Слабый ПК» в меню «Настройки → Производительность».</small></div>}
    </div>
  );
}
