/**
 * The AppFrame right panel's shipped size preset, in CSS pixels: the bounds the
 * frame specimen passes as `rightPanel.min`, `rightPanel.max` and
 * `rightPanel.defaultValue`. Designer library columns read their maximum
 * width from this one object rather than copying its numbers.
 */
export const APP_FRAME_RIGHT_PANEL_CONFIG: Readonly<{ min: number; max: number; defaultValue: number }> = Object.freeze({ min: 220, max: 420, defaultValue: 280 });
