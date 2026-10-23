import { Stat } from "@clossys/designer/blocks";

function ActiveUsersStat() {
  return (
    <Stat
      label="Monthly active users"
      value="2,481"
      delta="+12%"
      trend="up"
      description="vs. last 30 days"
    />
  );
}

export default ActiveUsersStat;
