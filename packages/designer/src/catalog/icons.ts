import { AlertTriangle } from "../icons/AlertTriangle.js";
import { ArrowRight } from "../icons/ArrowRight.js";
import { BookOpen } from "../icons/BookOpen.js";
import { Box } from "../icons/Box.js";
import { Briefcase } from "../icons/Briefcase.js";
import { Building2 } from "../icons/Building2.js";
import { Calendar } from "../icons/Calendar.js";
import { Check } from "../icons/Check.js";
import { CheckCircle } from "../icons/CheckCircle.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { ChevronUp } from "../icons/ChevronUp.js";
import { Clock } from "../icons/Clock.js";
import { CreditCard } from "../icons/CreditCard.js";
import { ExternalLink } from "../icons/ExternalLink.js";
import { FileCheck } from "../icons/FileCheck.js";
import { FileText } from "../icons/FileText.js";
import { Folder } from "../icons/Folder.js";
import { Globe } from "../icons/Globe.js";
import { Grid3x3 } from "../icons/Grid3x3.js";
import { Home } from "../icons/Home.js";
import { Info } from "../icons/Info.js";
import { Landmark } from "../icons/Landmark.js";
import { Layers } from "../icons/Layers.js";
import { List } from "../icons/List.js";
import { Lock } from "../icons/Lock.js";
import { Monitor } from "../icons/Monitor.js";
import { Moon } from "../icons/Moon.js";
import { PanelLeft } from "../icons/PanelLeft.js";
import { Plug } from "../icons/Plug.js";
import { Receipt } from "../icons/Receipt.js";
import { Scale } from "../icons/Scale.js";
import { Search } from "../icons/Search.js";
import { Settings } from "../icons/Settings.js";
import { ShieldCheck } from "../icons/ShieldCheck.js";
import { Sun } from "../icons/Sun.js";
import { User } from "../icons/User.js";
import { Users } from "../icons/Users.js";
import { X } from "../icons/X.js";
import { XCircle } from "../icons/XCircle.js";
import type { Catalog, CatalogTree, IconEntry, IconGroupMap } from "./types.js";

/** Icon display tree: 2 L1 groups (interface and subject glyphs), 11 L2 purpose groups. */
export const ICON_GROUPS: CatalogTree<IconGroupMap> = [
  {
    id: "interface",
    label: "Interface",
    children: [
      { id: "direction", label: "Direction" },
      { id: "controls", label: "Controls" },
      { id: "status", label: "Status" },
      { id: "theme", label: "Theme" },
    ],
  },
  {
    id: "subject",
    label: "Subject",
    children: [
      { id: "people", label: "People" },
      { id: "places", label: "Places" },
      { id: "documents", label: "Documents" },
      { id: "time", label: "Time" },
      { id: "commerce", label: "Commerce" },
      { id: "trust", label: "Trust" },
      { id: "structure", label: "Structure" },
    ],
  },
];

/**
 * Glyph leaves: all 40 vendored glyphs, each placed once. `naming` is the
 * glyph's usual role; the Icon component still decides per use. Licence trail:
 * THIRD-PARTY-NOTICES.md.
 */
export const ICON_ENTRIES: readonly IconEntry[] = [
  {
    id: "ChevronDown", label: "Chevron down", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "chevron-down", version: "1.23.0" },
    nodes: ChevronDown, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "ChevronUp", label: "Chevron up", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "chevron-up", version: "1.23.0" },
    nodes: ChevronUp, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "ChevronLeft", label: "Chevron left", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "chevron-left", version: "1.23.0" },
    nodes: ChevronLeft, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: true, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "ChevronRight", label: "Chevron right", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "chevron-right", version: "1.23.0" },
    nodes: ChevronRight, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: true, lifecycle: "draft", ownerReview: "not-yet-reviewed",
    notes: ["The default trailing icon of the quiet Button."],
  },
  {
    id: "ArrowRight", label: "Arrow right", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "arrow-right", version: "1.24.0" },
    nodes: ArrowRight, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: true, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "ExternalLink", label: "External link", l1: "interface", l2: "direction",
    source: { library: "lucide", name: "external-link", version: "1.23.0" },
    nodes: ExternalLink, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
    notes: ["Does not mirror in right-to-left text."],
  },
  {
    id: "Search", label: "Search", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "search", version: "1.23.0" },
    nodes: Search, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "X", label: "X", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "x", version: "1.23.0" },
    nodes: X, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Check", label: "Check", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "check", version: "1.23.0" },
    nodes: Check, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Settings", label: "Settings", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "settings", version: "1.23.0" },
    nodes: Settings, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "List", label: "List", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "list", version: "1.23.0" },
    nodes: List, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Grid3x3", label: "Grid 3x3", l1: "interface", l2: "controls",
    source: { library: "lucide", name: "grid-3x3", version: "1.23.0" },
    nodes: Grid3x3, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "AlertTriangle", label: "Alert triangle", l1: "interface", l2: "status",
    source: { library: "lucide", name: "triangle-alert", version: "1.23.0", renamedFrom: "alert-triangle" },
    nodes: AlertTriangle, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "CheckCircle", label: "Check circle", l1: "interface", l2: "status",
    source: { library: "lucide", name: "circle-check-big", version: "1.23.0", renamedFrom: "check-circle" },
    nodes: CheckCircle, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "XCircle", label: "X circle", l1: "interface", l2: "status",
    source: { library: "lucide", name: "circle-x", version: "1.23.0", renamedFrom: "x-circle" },
    nodes: XCircle, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Info", label: "Info", l1: "interface", l2: "status",
    source: { library: "lucide", name: "info", version: "1.23.0" },
    nodes: Info, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Sun", label: "Sun", l1: "interface", l2: "theme",
    source: { library: "lucide", name: "sun", version: "1.23.0" },
    nodes: Sun, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Moon", label: "Moon", l1: "interface", l2: "theme",
    source: { library: "lucide", name: "moon", version: "1.23.0" },
    nodes: Moon, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Monitor", label: "Monitor", l1: "interface", l2: "theme",
    source: { library: "lucide", name: "monitor", version: "1.23.0" },
    nodes: Monitor, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "labelled", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "User", label: "User", l1: "subject", l2: "people",
    source: { library: "lucide", name: "user", version: "1.23.0" },
    nodes: User, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Users", label: "Users", l1: "subject", l2: "people",
    source: { library: "lucide", name: "users", version: "1.23.0" },
    nodes: Users, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Home", label: "Home", l1: "subject", l2: "places",
    source: { library: "lucide", name: "house", version: "1.23.0", renamedFrom: "home" },
    nodes: Home, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Building2", label: "Building 2", l1: "subject", l2: "places",
    source: { library: "lucide", name: "building-2", version: "1.23.0" },
    nodes: Building2, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Globe", label: "Globe", l1: "subject", l2: "places",
    source: { library: "lucide", name: "globe", version: "1.24.0" },
    nodes: Globe, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Landmark", label: "Landmark", l1: "subject", l2: "places",
    source: { library: "lucide", name: "landmark", version: "1.24.0" },
    nodes: Landmark, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "BookOpen", label: "Book open", l1: "subject", l2: "documents",
    source: { library: "lucide", name: "book-open", version: "1.23.0" },
    nodes: BookOpen, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "FileText", label: "File text", l1: "subject", l2: "documents",
    source: { library: "lucide", name: "file-text", version: "1.23.0" },
    nodes: FileText, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "FileCheck", label: "File check", l1: "subject", l2: "documents",
    source: { library: "lucide", name: "file-check", version: "1.24.0" },
    nodes: FileCheck, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Folder", label: "Folder", l1: "subject", l2: "documents",
    source: { library: "lucide", name: "folder", version: "1.23.0" },
    nodes: Folder, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Calendar", label: "Calendar", l1: "subject", l2: "time",
    source: { library: "lucide", name: "calendar", version: "1.23.0" },
    nodes: Calendar, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Clock", label: "Clock", l1: "subject", l2: "time",
    source: { library: "lucide", name: "clock", version: "1.23.0" },
    nodes: Clock, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "CreditCard", label: "Credit card", l1: "subject", l2: "commerce",
    source: { library: "lucide", name: "credit-card", version: "1.23.0" },
    nodes: CreditCard, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Receipt", label: "Receipt", l1: "subject", l2: "commerce",
    source: { library: "lucide", name: "receipt", version: "1.23.0" },
    nodes: Receipt, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Briefcase", label: "Briefcase", l1: "subject", l2: "commerce",
    source: { library: "lucide", name: "briefcase", version: "1.24.0" },
    nodes: Briefcase, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "ShieldCheck", label: "Shield check", l1: "subject", l2: "trust",
    source: { library: "lucide", name: "shield-check", version: "1.24.0" },
    nodes: ShieldCheck, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Lock", label: "Lock", l1: "subject", l2: "trust",
    source: { library: "lucide", name: "lock", version: "1.23.0" },
    nodes: Lock, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Scale", label: "Scale", l1: "subject", l2: "trust",
    source: { library: "lucide", name: "scale", version: "1.24.0" },
    nodes: Scale, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Box", label: "Box", l1: "subject", l2: "structure",
    source: { library: "lucide", name: "box", version: "1.23.0" },
    nodes: Box, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Layers", label: "Layers", l1: "subject", l2: "structure",
    source: { library: "lucide", name: "layers", version: "1.24.0" },
    nodes: Layers, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "Plug", label: "Plug", l1: "subject", l2: "structure",
    source: { library: "lucide", name: "plug", version: "1.23.0" },
    nodes: Plug, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
  {
    id: "PanelLeft", label: "Panel left", l1: "subject", l2: "structure",
    source: { library: "lucide", name: "panel-left", version: "1.24.0" },
    nodes: PanelLeft, sizes: ["sm", "md", "lg"], stroke: { lever: "--ui-icon-stroke" },
    naming: "decorative", mirrorInRtl: false, lifecycle: "draft", ownerReview: "not-yet-reviewed",
  },
];

export const ICON_CATALOG: Catalog<"icons", IconGroupMap, IconEntry> = {
  kind: "icons",
  groups: ICON_GROUPS,
  entries: ICON_ENTRIES,
};
