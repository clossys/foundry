/**
 * The streaming scripts of the Publisher-installed Next shell, registered by exact shape.
 *
 * Decision (W2, 2026-11-10). The shell Publisher installs (`NEXT_SHELL_FILES`) includes an
 * app-root `loading.tsx`, so every route renders inside a root Suspense boundary. When a route
 * suspends past the shell (Studio's `/` and `/content` load their records asynchronously), React's
 * streaming renderer (Fizz, vendored by Next 16.4) writes two inline instruction scripts directly
 * under `<body>`: the shell-time mark and the boundary completion that swaps the streamed segment
 * into the boundary. They carry no attribute but an optional CSP `nonce`, and no provenance marker
 * can be put on them. They are framework output of Publisher's own shell contract, not page
 * content, so Publisher registers them here, the same way the shell files are registered, rather
 * than dropping the loading state from the contract.
 *
 * Only these exact texts are registered: the shell-time mark verbatim, and one completion call
 * `$RC("B:<hex>","S:<hex>")`, optionally preceded once by React's completion runtime verbatim.
 * Nothing else is: no other attribute, no extra statement, no segment (`$RS`), client-render
 * error (`$RX`), style-wait (`$RR`) or view-transition instruction. Those stay findings for a
 * rendered-provenance check, and an error boundary in particular must stay visible. A Next or
 * React upgrade that changes a text fails the registration test, never widens it.
 */

/** React Fizz's shell-time mark, written once when the shell flushes with a boundary still pending. */
export const NEXT_SHELL_TIME_SCRIPT = "requestAnimationFrame(function(){$RT=performance.now()});";

/** React Fizz's boundary-completion runtime, written once before the first completion call. */
export const NEXT_BOUNDARY_RUNTIME = '$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if("/$"===d||"/&"===d)if(0===h)break;else h--;else"$"!==d&&"$?"!==d&&"$~"!==d&&"$!"!==d&&"&"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data="$";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data="$~",$RB.push(a,b),2===$RB.length&&("number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};';

/** One boundary completion call: the boundary and segment ids React assigns (`B:` and `S:` plus hex). */
const COMPLETION_CALL = /^\$RC\("B:[0-9a-f]+","S:[0-9a-f]+"\)$/;

/** An inline script as rendered: its attribute names and its text. */
export interface NextStreamingScript {
  readonly attributes: readonly string[];
  readonly text: string;
}

/** Which registered shape an inline body-level script is, or `undefined` when it is none. */
export function nextStreamingScriptShape(script: NextStreamingScript): "shell-time" | "boundary-completion" | undefined {
  if (!script.attributes.every(name => name === "nonce")) return undefined;
  if (script.text === NEXT_SHELL_TIME_SCRIPT) return "shell-time";
  const call = script.text.startsWith(NEXT_BOUNDARY_RUNTIME) ? script.text.slice(NEXT_BOUNDARY_RUNTIME.length) : script.text;
  return COMPLETION_CALL.test(call) ? "boundary-completion" : undefined;
}
