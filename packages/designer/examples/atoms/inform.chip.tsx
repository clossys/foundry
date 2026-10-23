import { Chip } from "@clossys/designer/atoms";

function TeamFilter({ teams, onRemove }: { teams: string[]; onRemove: (team: string) => void }) {
  return (
    <div className="flex flex-wrap gap-xs">
      {teams.map((team) => (
        <Chip key={team} onRemove={() => onRemove(team)} removeLabel={`Remove ${team}`}>
          {team}
        </Chip>
      ))}
    </div>
  );
}

export default TeamFilter;
export const smokeProps = { teams: ["Design"], onRemove: (_team: string): void => {} } satisfies React.ComponentProps<typeof TeamFilter>;
