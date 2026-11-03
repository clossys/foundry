// Violation: an App Router page that renders its own markup instead of mounting PublishedPage for a record.
export default function ProbePage() {
  return <main><h1>Hand-built page</h1></main>;
}
