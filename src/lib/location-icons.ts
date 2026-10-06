import {
  Accessibility,
  AirVent,
  AlarmSmoke,
  Antenna,
  Archive,
  Armchair,
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpToLine,
  Baby,
  Bath,
  BatteryCharging,
  BellElectric,
  BellRing,
  Boxes,
  Briefcase,
  Building,
  Building2,
  Bus,
  Cable,
  Camera,
  Car,
  Cctv,
  ChefHat,
  Church,
  CircuitBoard,
  Coffee,
  Cog,
  Computer,
  createLucideIcon,
  ConciergeBell,
  Construction,
  Container,
  Cpu,
  CreditCard,
  Crosshair,
  DoorClosed,
  DoorClosedLocked,
  DoorOpen,
  Droplets,
  Dumbbell,
  EthernetPort,
  Factory,
  Fan,
  Fence,
  Fingerprint,
  FireExtinguisher,
  Flag,
  Flame,
  Forklift,
  Fuel,
  Gauge,
  HardDrive,
  HardHat,
  Heater,
  Hospital,
  Hotel,
  House,
  HousePlug,
  Inbox,
  InspectionPanel,
  KeyRound,
  LampCeiling,
  Landmark,
  Layers,
  Lightbulb,
  LocateFixed,
  Lock,
  type LucideIcon,
  Mailbox,
  MapPin,
  Megaphone,
  Monitor,
  Mountain,
  Network,
  Package,
  PanelTop,
  Phone,
  PhoneCall,
  Plane,
  Plug,
  PlugZap,
  Power,
  Presentation,
  Printer,
  Radio,
  RadioTower,
  Router,
  Satellite,
  SatelliteDish,
  School,
  ScanFace,
  Server,
  ServerCog,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Signal,
  Siren,
  Snowflake,
  SolarPanel,
  Speaker,
  SquareParking,
  Store,
  Sun,
  Thermometer,
  Toilet,
  Toolbox,
  TowerControl,
  TrafficCone,
  TrainFront,
  Trees,
  Truck,
  Tv,
  Users,
  UtensilsCrossed,
  Warehouse,
  Waves,
  Webcam,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * The pictures a location can carry.
 *
 * A pill that says "IDF 2" next to one that says "IDF" is read by the word; a
 * rack next to a door next to a fire bell is read at a glance, in a dark room,
 * by somebody holding a ladder. So each location gets an icon, picked from
 * here, and the list is searched by the words a tech would use — "telco",
 * "demarc", "elevator", "FACP" — rather than by what the icon happens to be
 * called.
 *
 * What is stored is the key, never a component, so the picture can be redrawn
 * by a later icon set without touching a row. A key nobody recognises any more
 * draws the plain pin.
 */

/**
 * An elevator's traction machine — the sheave whose ropes carry the car on
 * one side and the counterweight on the other. The set has no elevator of
 * its own, and the machine room is the one place a tech needs to find among
 * the other plant rooms; drawn on the same grid and stroke as the rest.
 */
const ElevatorMachine = createLucideIcon("elevator-machine", [
  ["circle", { cx: "12", cy: "6", r: "4", key: "sheave" }],
  ["path", { d: "M8 6v9", key: "car-rope" }],
  ["path", { d: "M16 6v5", key: "weight-rope" }],
  ["rect", { x: "4", y: "15", width: "8", height: "7", rx: "1", key: "car" }],
  ["rect", { x: "14", y: "11", width: "4", height: "7", rx: "1", key: "weight" }],
]);

export type IconEntry = {
  /** Stored on the location. Stable: renaming one orphans every row using it. */
  key: string;
  icon: LucideIcon;
  /** What the picker calls it. */
  label: string;
  /** Searched as well as the label: the trade's words for what it shows. */
  words: string[];
  group: IconGroup;
};

export const ICON_GROUPS = [
  "Network & telecom",
  "Power & building systems",
  "Safety & security",
  "Rooms & areas",
  "Building & outside",
  "Retail & hospitality",
  "Transport",
  "Markers",
] as const;

export type IconGroup = (typeof ICON_GROUPS)[number];

/** Drawn when a location has no icon, or one this list no longer knows. */
export const DEFAULT_LOCATION_ICON = "map-pin";

type Row = [key: string, icon: LucideIcon, label: string, words: string];

function group(name: IconGroup, rows: Row[]): IconEntry[] {
  return rows.map(([key, icon, label, words]) => ({
    key,
    icon,
    label,
    words: words.split(/\s+/).filter(Boolean),
    group: name,
  }));
}

export const LOCATION_ICONS: IconEntry[] = [
  ...group("Network & telecom", [
    ["server", Server, "Server rack", "rack mdf idf frame data network cabinet"],
    ["server-cog", ServerCog, "Server room", "datacenter data center equipment room rack"],
    ["network", Network, "Network", "idf switch distribution lan topology"],
    ["router", Router, "Router", "modem switch gateway isp internet"],
    ["ethernet-port", EthernetPort, "Ethernet jack", "port jack drop rj45 data outlet patch"],
    ["cable", Cable, "Cable", "demarc wiring cabling run pathway"],
    ["house-plug", HousePlug, "Demarc", "demarcation telco entrance service handoff nid"],
    ["phone", Phone, "Phone", "telco pots line telephone handset"],
    ["phone-call", PhoneCall, "Emergency phone", "elevator phone call box emergency intercom"],
    ["wifi", Wifi, "Wi-Fi", "access point ap wireless wlan"],
    ["signal", Signal, "Signal", "cellular lte 5g reception booster das"],
    ["antenna", Antenna, "Antenna", "aerial roof mast"],
    ["radio-tower", RadioTower, "Radio tower", "antenna cell tower mast transmitter das"],
    ["satellite-dish", SatelliteDish, "Satellite dish", "dish vsat roof receiver"],
    ["satellite", Satellite, "Satellite", "gps vsat uplink"],
    ["radio", Radio, "Radio", "two-way intercom paging"],
    ["hard-drive", HardDrive, "Storage", "nvr dvr recorder disk drive"],
    ["cpu", Cpu, "Controller", "controller board processor head end"],
    ["circuit-board", CircuitBoard, "Panel board", "board controller backboard plywood"],
    ["computer", Computer, "Workstation", "pc desktop terminal computer"],
    ["monitor", Monitor, "Screen", "display monitor kiosk signage"],
    ["tv", Tv, "TV", "television display signage screen"],
    ["printer", Printer, "Printer", "printer copier mfp"],
  ]),
  ...group("Power & building systems", [
    ["zap", Zap, "Electrical", "electrical power electric room voltage"],
    ["inspection-panel", InspectionPanel, "Electrical panel", "breaker panel subpanel electrical box"],
    ["plug", Plug, "Outlet", "outlet receptacle power socket"],
    ["plug-zap", PlugZap, "Power feed", "power feed circuit dedicated ups"],
    ["power", Power, "Power switch", "on off switch shutoff disconnect"],
    ["battery-charging", BatteryCharging, "UPS / battery", "ups battery backup charger"],
    ["solar-panel", SolarPanel, "Solar", "solar pv panel array"],
    ["lightbulb", Lightbulb, "Lighting", "light lighting fixture lamp"],
    ["lamp-ceiling", LampCeiling, "Ceiling", "ceiling drop tile plenum above"],
    ["fan", Fan, "Mechanical", "mechanical hvac fan exhaust blower"],
    ["air-vent", AirVent, "HVAC", "hvac vent duct air conditioning"],
    ["heater", Heater, "Heating", "heater boiler furnace"],
    ["thermometer", Thermometer, "Temperature", "temperature sensor cooler freezer"],
    ["snowflake", Snowflake, "Cooler", "cooler freezer walk-in refrigeration cold"],
    ["droplets", Droplets, "Plumbing", "water plumbing sprinkler riser leak"],
    ["gauge", Gauge, "Meter", "meter gauge utility reading"],
    ["arrow-up-down", ArrowUpDown, "Elevator", "elevator lift cab car hoistway"],
    ["elevator-machine", ElevatorMachine, "Elevator machine", "elevator lift machine control room traction hoist sheave motor"],
    ["cog", Cog, "Machine room", "machine room motor equipment gear"],
    ["wrench", Wrench, "Utility room", "utility maintenance janitor workshop"],
    ["toolbox", Toolbox, "Tools", "tools maintenance shop storage"],
  ]),
  ...group("Safety & security", [
    ["siren", Siren, "Fire alarm panel", "facp fire alarm panel annunciator"],
    ["bell-electric", BellElectric, "Alarm bell", "bell horn strobe notification"],
    ["alarm-smoke", AlarmSmoke, "Smoke detector", "smoke detector sensor head"],
    ["flame", Flame, "Fire", "fire riser sprinkler"],
    ["fire-extinguisher", FireExtinguisher, "Extinguisher", "extinguisher fire safety"],
    ["shield", Shield, "Security", "security desk guard post"],
    ["shield-check", ShieldCheck, "Checkpoint", "checkpoint screening tsa inspection"],
    ["cctv", Cctv, "Camera", "camera cctv surveillance ptz dome"],
    ["camera", Camera, "Photo point", "camera photo picture"],
    ["webcam", Webcam, "Indoor camera", "camera webcam indoor"],
    ["lock", Lock, "Locked room", "locked secure restricted"],
    ["key-round", KeyRound, "Key", "key access lockbox"],
    ["door-closed-locked", DoorClosedLocked, "Access door", "access control door card reader maglock"],
    ["fingerprint", Fingerprint, "Biometric", "biometric reader fingerprint"],
    ["scan-face", ScanFace, "Face reader", "face reader biometric"],
    ["megaphone", Megaphone, "Paging", "paging speaker announce pa"],
    ["speaker", Speaker, "Speaker", "speaker audio sound"],
    ["traffic-cone", TrafficCone, "Hazard", "hazard caution cone"],
    ["hard-hat", HardHat, "Construction", "construction site hardhat"],
    ["construction", Construction, "Work zone", "barrier work zone roadwork"],
  ]),
  ...group("Rooms & areas", [
    ["door-closed", DoorClosed, "Closet", "closet comms room telco room door"],
    ["door-open", DoorOpen, "Entrance", "entrance entry door vestibule"],
    ["briefcase", Briefcase, "Office", "office back office manager"],
    ["users", Users, "Meeting room", "conference meeting room boardroom"],
    ["presentation", Presentation, "Training room", "training classroom presentation"],
    ["armchair", Armchair, "Lobby", "lobby waiting area lounge"],
    ["concierge-bell", ConciergeBell, "Front desk", "front desk reception check-in counter"],
    ["coffee", Coffee, "Break room", "break room kitchenette lounge"],
    ["utensils-crossed", UtensilsCrossed, "Dining", "dining foh front of house cafeteria restaurant food court lobby"],
    ["chef-hat", ChefHat, "Kitchen", "kitchen boh back of house"],
    ["toilet", Toilet, "Restroom", "restroom bathroom toilet washroom"],
    ["bath", Bath, "Bathroom", "bathroom shower"],
    ["baby", Baby, "Nursery", "nursery family room"],
    ["accessibility", Accessibility, "Accessible", "ada accessible accessibility"],
    ["dumbbell", Dumbbell, "Gym", "gym fitness"],
    ["archive", Archive, "Records", "records file room archive"],
    ["inbox", Inbox, "Mail room", "mail room shipping receiving"],
    ["mailbox", Mailbox, "Mailbox", "mailbox mail"],
    ["layers", Layers, "Floor", "floor level storey"],
    ["arrow-down-to-line", ArrowDownToLine, "Basement", "basement pit below lower level"],
    ["arrow-up-to-line", ArrowUpToLine, "Attic", "attic top floor upper level"],
    ["panel-top", PanelTop, "Wall", "wall mount backboard"],
  ]),
  ...group("Building & outside", [
    ["building", Building, "Building", "building office tower"],
    ["building-2", Building2, "Campus", "campus complex multiple buildings"],
    ["house", House, "Roof", "roof rooftop house home residence"],
    ["warehouse", Warehouse, "Warehouse", "warehouse distribution storage"],
    ["factory", Factory, "Plant", "factory plant production"],
    ["hospital", Hospital, "Hospital", "hospital clinic medical"],
    ["school", School, "School", "school campus classroom"],
    ["hotel", Hotel, "Hotel", "hotel guest rooms"],
    ["landmark", Landmark, "Bank", "bank government courthouse atm"],
    ["church", Church, "Church", "church worship chapel"],
    ["trees", Trees, "Exterior", "exterior outside outdoor grounds yard"],
    ["sun", Sun, "Outdoors", "outdoor exposed weather"],
    ["mountain", Mountain, "Remote site", "remote site rural hill"],
    ["fence", Fence, "Fence line", "fence perimeter gate yard"],
    ["waves", Waves, "Pool", "pool water"],
  ]),
  ...group("Retail & hospitality", [
    ["store", Store, "Sales floor", "store sales floor shop retail front"],
    ["shopping-cart", ShoppingCart, "Aisle", "aisle cart retail"],
    ["credit-card", CreditCard, "Registers", "pos register checkout point of sale cash"],
    ["boxes", Boxes, "Stockroom", "stockroom back room inventory storage"],
    ["package", Package, "Shipping", "shipping package parcel"],
    ["container", Container, "Container", "container conex trailer"],
  ]),
  ...group("Transport", [
    ["square-parking", SquareParking, "Parking", "parking garage lot deck"],
    ["car", Car, "Drive-thru", "drive-thru drivethru dt lane window garage car vehicle"],
    ["truck", Truck, "Loading dock", "loading dock receiving truck bay"],
    ["forklift", Forklift, "Dock floor", "forklift warehouse dock"],
    ["fuel", Fuel, "Fuel island", "fuel gas pump station canopy"],
    ["bus", Bus, "Bus stop", "bus stop transit"],
    ["train-front", TrainFront, "Rail", "train rail station platform"],
    ["plane", Plane, "Gate", "airport gate terminal concourse"],
    ["tower-control", TowerControl, "Control tower", "airport tower atc control"],
  ]),
  ...group("Markers", [
    ["map-pin", MapPin, "Pin", "pin location place spot"],
    ["locate-fixed", LocateFixed, "Install point", "install point target spot device"],
    ["crosshair", Crosshair, "Target", "target aim exact"],
    ["flag", Flag, "Flag", "flag marker start"],
  ]),
];

const BY_KEY = new Map(LOCATION_ICONS.map((entry) => [entry.key, entry]));

export function isLocationIcon(key: string | null | undefined): key is string {
  return typeof key === "string" && BY_KEY.has(key);
}

/** The entry for a stored key, falling back to the plain pin. */
export function locationIcon(key: string | null | undefined): IconEntry {
  return BY_KEY.get(key ?? "") ?? BY_KEY.get(DEFAULT_LOCATION_ICON)!;
}

/**
 * Icons whose label or words match what was typed.
 *
 * Every word typed has to match the start of one of the entry's words, so
 * "fire pan" finds the fire alarm panel and "elev" finds the lift. Ranked:
 * the label beginning with the query, then a label word, then a trade word
 * matched whole, then one merely begun — so typing "camera" puts Camera above
 * the things that merely have one.
 */
export function searchIcons(query: string): IconEntry[] {
  // Numbers say which one — "IDF 2", "DT Lane1" — not what it is, so they
  // are not searched for, standing alone or stuck to the end of a word.
  const terms = query
    .toLowerCase()
    .split(/[\s/,-]+/)
    .map((term) => term.replace(/\d+$/, ""))
    .filter(Boolean);
  if (terms.length === 0) return LOCATION_ICONS;

  const scored = LOCATION_ICONS.map((entry, index) => {
    const label = entry.label.toLowerCase();
    const labelWords = label.split(/[\s/-]+/);
    const all = [...labelWords, ...entry.words, entry.key];
    const matches = terms.every((term) =>
      all.some((word) => word.startsWith(term)),
    );
    if (!matches) return null;

    const first = terms[0];
    const score = label.startsWith(query.trim().toLowerCase())
      ? 0
      : labelWords.some((word) => word.startsWith(first))
        ? 1
        : // "pos" is the point of sale, not every word that starts "pos".
          terms.every((term) => all.includes(term))
          ? 2
          : 3;
    return { entry, score, index };
  }).filter((one) => one !== null);

  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((one) => one.entry);
}
