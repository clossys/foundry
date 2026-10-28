import type { UsagePanelLabels } from './UsagePanel.js';
import { readStudioCopy, type StudioCopyBinding } from '../copy-binding.js';

/** Registered usage copy; the host supplies Writer and the requested locale. */
export function createStudioUsageLabels(binding: StudioCopyBinding): UsagePanelLabels {
  return {
    title: readStudioCopy(binding, { id: 'st.c4a87fn3bk' }),
    using: readStudioCopy(binding, { id: 'st.5wb5mte3br' }),
    usedWhere: readStudioCopy(binding, { id: 'st.7pxepx20q1' }),
    reads: readStudioCopy(binding, { id: 'st.pavb1ytaa6' }),
    composes: readStudioCopy(binding, { id: 'st.5bmmq4jy68' }),
    options: readStudioCopy(binding, { id: 'st.p24ypyt9sb' }),
    owns: readStudioCopy(binding, { id: 'st.w4kjq0eysq' }),
    exceptions: readStudioCopy(binding, { id: 'st.7pe3p3k88p' }),
    transitive: readStudioCopy(binding, { id: 'st.0z0wp68nmd' }),
    back: readStudioCopy(binding, { id: 'st.hcq4hmxrrk' }),
    usedNowhere: readStudioCopy(binding, { id: 'st.111p0y7vyt' }),
    notLinked: readStudioCopy(binding, { id: 'st.3g545xa0gy' }),
    loading: readStudioCopy(binding, { id: 'st.h0jcz83wh7' }),
    none: readStudioCopy(binding, { id: 'st.6vygykgwag' }),
    layer: {
    tokens: readStudioCopy(binding, { id: 'st.c331pzvwey' }),
    assets: readStudioCopy(binding, { id: 'st.7fsbf7m1ak' }),
    components: readStudioCopy(binding, { id: 'st.jht60wz8e1' }),
    sections: readStudioCopy(binding, { id: 'st.pvbdyf5y7k' }),
    frames: readStudioCopy(binding, { id: 'st.7rv315vzjm' }),
    pages: readStudioCopy(binding, { id: 'st.bgkzpf1ec0' }),
  },
    kind: {
    reads: readStudioCopy(binding, { id: 'st.37fjmkt06h' }),
    composes: readStudioCopy(binding, { id: 'st.43k2vndngq' }),
    hosts: readStudioCopy(binding, { id: 'st.d5xzr4hm25' }),
    renders: readStudioCopy(binding, { id: 'st.9gvj0ybvvx' }),
  },
    evidence: {
    declared: readStudioCopy(binding, { id: 'st.0kg0k8rhba' }),
    scanned: readStudioCopy(binding, { id: 'st.vq38fwsqs3' }),
    runtime: readStudioCopy(binding, { id: 'st.amrnkewdar' }),
  },
    count: (count: number) => readStudioCopy(binding, { id: 'st.yc2bsf3aq4' }, { count }),
  };
}
