import ts from '../../node_modules/typescript/lib/typescript.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Public declaration evidence complements (and never substitutes for) browser behavior. */
export function optionDeclarations() {
  const file = resolve('node_modules/.cache/browser-evidence/options.check.ts');
  writeFileSync(file, 'import type { PostHogConfig, AutocaptureConfig, SessionRecordingOptions } from "posthog-js";\ndeclare const config: PostHogConfig;\ndeclare const autocapture: AutocaptureConfig;\ndeclare const recording: SessionRecordingOptions;\n');
  const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, noEmit: true });
  const checker = program.getTypeChecker(), source = program.getSourceFile(file);
  const types = {};
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const type = checker.getTypeAtLocation(declaration.name);
      types[declaration.name.getText(source)] = new Set(checker.getPropertiesOfType(type).map(property => property.name));
    }
  }
  const names = {
    config: ['api_host', 'autocapture', 'rageclick', 'capture_pageview', 'capture_pageleave',
      'capture_dead_clicks', 'capture_exceptions', 'capture_performance', 'enable_heatmaps',
      'disable_session_recording', 'disable_surveys', 'disable_web_experiments',
      'advanced_disable_feature_flags', 'advanced_disable_feature_flags_on_first_load',
      'person_profiles', 'persistence', 'opt_out_capturing_by_default', 'before_send',
      'mask_all_text', 'respect_dnt', 'session_recording', 'enable_recording_console_log'],
    autocapture: ['dom_event_allowlist', 'css_selector_allowlist', 'capture_copied_text'],
    recording: ['maskAllInputs', 'maskTextSelector', 'blockSelector', 'recordHeaders', 'recordBody',
      'recordCanvas', 'compressEvents', 'recordCrossOriginIframes'],
  };
  const declarations = Object.fromEntries(Object.entries(names).map(([type, keys]) => [type,
    Object.fromEntries(keys.map(key => [key, types[type].has(key)]))]));
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  return { declarations, diagnostics, unknownOptionControl: types.config.has('evidence_unknown_option') };
}
