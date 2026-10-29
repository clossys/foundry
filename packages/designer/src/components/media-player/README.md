# MediaPlayer

A draft inline video component composed from the existing Button, ToggleButton,
Slider, Icon and SemanticContent parts. Supply the resolved `assets.video` resource
as `video`, the `assets.image` still as `poster`, and resolved Writer fields as
`passage`. No English labels or fallback messages are embedded in the component.

`controls="full"` includes the seek slider. `controls="minimal"` keeps playback,
mute and available captions. Caption tracks may come from `video.captions` or the
`captions` prop. Muting and captions use pressed-state toggle buttons.

The server emits the poster and play control with `preload="metadata"` and no
native autoplay attribute. Authored `autoplay` starts only when the media is
muted, reduced motion is off, and at least 25% of the player is visible. A user
pause persists across visibility and preference changes until the user explicitly
plays again. A new video source starts a fresh session. Playback pauses below 25%
visibility; a decoding/network failure restores the poster and the Writer error
passage. Browser rejection of a play request leaves play available for retry.

Focus the player group for Space or K to play/pause, Left/Right to seek five
seconds, M to toggle mute, and C to toggle available captions. The child controls
retain React Aria's keyboard behavior, including the seek slider's five-second
step. Reduced motion never starts automatic playback; the viewer may play
explicitly. Native looping occurs only after playback has started.

The draft Writer control strings are appended to the site record under IDs
`st.7mpayr0001` through `st.7mpayr0008`; `ps.7mpayr0001` composes the title and
recovery description through the existing `passages.error-message` schema. The
host resolves those records into `MediaPlayerPassage`, retaining its locale and
approval policy. The exported specimen accepts that same resolved data and
renders both control variants.
