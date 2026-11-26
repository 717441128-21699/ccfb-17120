import { AGE_LABELS } from '../config';
import { SyntheticSilkwormScene } from './SyntheticSilkwormScene';
import type { AgeStageId, ChannelConfig, EffectiveLight, LightPreset } from '../types';
import { h } from '../ui/dom';

const AGE_RATIO: Record<AgeStageId, number> = {
  early: 0.16,
  middle: 0.42,
  late: 0.72,
};

export interface DatasetMatrixHandle {
  element: HTMLElement;
  refresh: () => void;
  destroy: () => void;
}

export function createDatasetMatrix(): DatasetMatrixHandle {
  const element = h('div', { class: 'dataset-matrix', style: { marginTop: '14px' } });
  let refreshCount = 0;
  let scenes: SyntheticSilkwormScene[] = [];

  const refresh = () => {
    refreshCount++;
    scenes = [];
    element.replaceChildren();
    const ages: AgeStageId[] = ['early', 'middle', 'late'];
    const lights: Array<{ preset: LightPreset; label: string; mix?: number }> = [
      { preset: 'cfl', label: '节能灯' },
      { preset: 'switch', label: 'CFL→IR 中间帧', mix: 0.5 },
      { preset: 'ir', label: '红外补光' },
    ];

    for (const age of ages) {
      for (const light of lights) {
        const seed = 9000 + refreshCount * 1000 + ages.indexOf(age) * 100 + lights.indexOf(light) * 17;
        const config: ChannelConfig = {
          id: `dataset-${age}-${light.preset}-${refreshCount}`,
          name: `${age}-${light.preset}`,
          tray: 'dataset',
          seed,
          lightPreset: light.preset,
          age,
          matureRatio: AGE_RATIO[age],
          lamp: { x: 0.42 + ((seed % 30) - 15) / 100, y: -0.18, radius: 0.92, ambient: 0.18, peak: 1.2 },
          sourceKind: 'synthetic',
          sourceLabel: light.label,
        };
        const scene = new SyntheticSilkwormScene(config);
        if (light.mix !== undefined) scene.setLightMixForDataset(light.mix);
        const rendered = scene.render(performance.now() + seed);
        scenes.push(scene);

        const cell = h('div', { class: 'dataset-cell' }, scene.rawCanvas);
        scene.rawCanvas.style.width = '100%';
        scene.rawCanvas.style.height = '100%';
        const lightLabel: EffectiveLight | string = light.mix !== undefined ? '切换混合' : rendered.groundTruth.light === 'cfl' ? '节能灯' : '红外';
        cell.append(h('span', {
          text: `${AGE_LABELS[age].split(' · ')[0]} · ${lightLabel} · 真值 ${rendered.groundTruth.mature}/${rendered.groundTruth.total}`,
        }));
        element.append(cell);
      }
    }
  };

  refresh();
  return { element, refresh, destroy: () => { scenes = []; } };
}
