// Violation: a slot card that renders its specimen only sometimes, and never through the shared specimen section.
export type SlotCard = { title: string; specimen?: string };

export function SlotGroups({ cards }: { cards: SlotCard[] }) {
  return <ul>{cards.map(card => <li key={card.title}>{card.specimen ? card.specimen : null}</li>)}</ul>;
}
