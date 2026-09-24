export function Empty({ resolve, id }: { resolve: (id: string) => string; id: string }) {
  return <p aria-label={resolve(id)}>{resolve(id)}</p>;
}
