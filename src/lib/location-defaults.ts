/**
 * The locations offered on a fresh install, most used first.
 *
 * A starting point, not a standard: they are edited in Settings → Company, and
 * the seed only writes them into an empty table, so a rename or a removal
 * there is never undone by a later deploy.
 *
 * Kept free of imports on purpose. The seed reads it inside the migrator
 * image, which carries only the files it is given; the icon keys are checked
 * against the collection by the domain suite instead.
 */
export const DEFAULT_LOCATIONS: { label: string; icon: string }[] = [
  { label: "MDF", icon: "server" },
  { label: "IDF", icon: "network" },
  { label: "Demarc", icon: "house-plug" },
  { label: "Install point", icon: "locate-fixed" },
  { label: "Telco room", icon: "phone" },
  { label: "Comms closet", icon: "door-closed" },
  { label: "Server room", icon: "server-cog" },
  { label: "Electrical room", icon: "zap" },
  { label: "Electrical panel", icon: "inspection-panel" },
  { label: "Elevator machine room", icon: "elevator-machine" },
  { label: "Elevator cab", icon: "arrow-up-down" },
  { label: "Elevator pit", icon: "arrow-down-to-line" },
  { label: "Fire alarm panel", icon: "siren" },
  { label: "Security desk", icon: "shield" },
  { label: "Front desk", icon: "concierge-bell" },
  { label: "Back office", icon: "briefcase" },
  { label: "FoH", icon: "utensils-crossed" },
  { label: "Registers", icon: "credit-card" },
  { label: "BoH", icon: "chef-hat" },
  { label: "DT Lane1", icon: "car" },
  { label: "DT Lane2", icon: "car" },
  { label: "Ceiling", icon: "lamp-ceiling" },
  { label: "Roof", icon: "house" },
  { label: "Exterior", icon: "trees" },
  { label: "Parking garage", icon: "square-parking" },
  { label: "Loading dock", icon: "truck" },
];
