import type { InterviewProject } from "../../lib/domain";
import { Dashboard } from "../interview/Dashboard";

export function JobList({ projects, onCreate, onOpen, onEdit, onDelete }: { projects: InterviewProject[]; onCreate: () => void; onOpen: (project: InterviewProject) => void; onEdit: (project: InterviewProject) => void; onDelete: (project: InterviewProject) => void }) {
  return <Dashboard projects={projects} onCreate={onCreate} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete}/>;
}
