import { MediaFigure } from "@clossys/designer/blocks";

function Screenshot() {
  return (
    <MediaFigure caption="Caption text" measure="content">
      <img src="/media.png" alt="Media description" />
    </MediaFigure>
  );
}

export default Screenshot;
