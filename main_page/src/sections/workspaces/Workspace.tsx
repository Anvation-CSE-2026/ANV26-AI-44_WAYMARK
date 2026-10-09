import RoadAuthority from "./RoadAuthority";
import CityPlanner from "./CityPlanner";
import TrafficPolice from "./TrafficPolice";
import type { RoleKey } from "../../data/roles";

/** Renders the signed-in role's +1 workspace (exactly one per role). */
export default function Workspace({ role }: { role: RoleKey }) {
  if (role === "authority") return <RoadAuthority />;
  if (role === "planner") return <CityPlanner />;
  return <TrafficPolice />;
}
