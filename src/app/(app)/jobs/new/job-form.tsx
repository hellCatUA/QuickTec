"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { createJob, type ActionResult } from "../actions";

type Client = { id: string; name: string };
type Site = {
  id: string;
  siteNumber: string;
  city: string;
  state: string;
  customer: { id: string; code: string; name: string };
};
type Project = {
  id: string;
  name: string;
  externalProjectId: string | null;
  clientId: string;
  customerId: string | null;
  intWoCounter: number;
};
type Tech = { id: string; name: string; baseRole: string };

export function JobForm({
  canAssign,
  needsApproval,
  clients,
  sites,
  projects,
  techs,
  globalNextSequence,
  breakPaidByDefault,
}: {
  canAssign: boolean;
  needsApproval: boolean;
  clients: Client[];
  sites: Site[];
  projects: Project[];
  techs: Tech[];
  globalNextSequence: number;
  breakPaidByDefault: boolean;
}) {
  const router = useRouter();

  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await createJob(prev, formData);
      if (result.ok && result.id) router.push(`/jobs/${result.id}`);
      return result;
    },
    null,
  );

  // Only projects belonging to the chosen client can apply — the project's own
  // counter and ID would otherwise end up on another client's work order.
  const availableProjects = useMemo(
    () => projects.filter((project) => project.clientId === clientId),
    [projects, clientId],
  );

  const selectedProject = availableProjects.find(
    (project) => project.id === projectId,
  );

  // Mirrors formatIntWo on the server. Advisory only: the real number is
  // allocated inside the creating transaction, so a concurrent save can shift it.
  const intWoPreview = useMemo(() => {
    const date = scheduledStart ? new Date(scheduledStart) : new Date();
    if (Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const projectRef = selectedProject?.externalProjectId || "0000";
    const sequence = selectedProject
      ? selectedProject.intWoCounter + 1
      : globalNextSequence + 1;

    return `${year}-${month}-${projectRef}-${String(sequence).padStart(4, "0")}`;
  }, [scheduledStart, selectedProject, globalNextSequence]);

  const defaultLead =
    techs.find(
      (tech) => assignees.includes(tech.id) && tech.baseRole !== "TECH",
    )?.id ?? assignees[0];
  const effectiveLead = assignees.includes(leadId) ? leadId : defaultLead;

  const multiTechNoSupervisor =
    assignees.length > 1 &&
    !techs.some(
      (tech) => assignees.includes(tech.id) && tech.baseRole !== "TECH",
    );

  function toggleAssignee(id: string) {
    setAssignees((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
          {intWoPreview ? (
            <CardDescription>
              Internal work order number will be{" "}
              <span className="tabular font-medium text-foreground">
                {intWoPreview}
              </span>
            </CardDescription>
          ) : null}
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" htmlFor="title" className="sm:col-span-2">
            <Input
              id="title"
              name="title"
              placeholder="Switch replacement"
              required
              autoComplete="off"
            />
          </Field>

          <Field
            label="Client"
            htmlFor="clientId"
            hint="The buyer / representing company."
          >
            <Select
              id="clientId"
              name="clientId"
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setProjectId("");
              }}
              required
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Project"
            htmlFor="projectId"
            hint={
              availableProjects.length === 0
                ? "No active projects for this client. The job will use the yearly counter."
                : "Blank uses the global yearly counter and 0000 as the project ref."
            }
          >
            <Select
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={availableProjects.length === 0}
            >
              <option value="">— no project —</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.externalProjectId
                    ? ` (${project.externalProjectId})`
                    : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Site"
            htmlFor="siteId"
            hint="Supplies the customer and the address on the report."
            className="sm:col-span-2"
          >
            <Select
              id="siteId"
              name="siteId"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a site…
              </option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.customer.code} #{site.siteNumber} — {site.city},{" "}
                  {site.state}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Assignment ID"
            htmlFor="externalAssignmentId"
            hint="The client's own ID for this work order. Shared by everyone on site."
          >
            <Input
              id="externalAssignmentId"
              name="externalAssignmentId"
              placeholder="887766"
              autoComplete="off"
            />
          </Field>

          <Field label="Ticket #" htmlFor="ticketNumber">
            <Input id="ticketNumber" name="ticketNumber" autoComplete="off" />
          </Field>

          <Field label="INC #" htmlFor="incNumber" hint="Internal only.">
            <Input id="incNumber" name="incNumber" autoComplete="off" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Scheduled start"
            htmlFor="scheduledStart"
            hint="Site local time. Also decides the YYYY-MM of the WO number."
          >
            <Input
              id="scheduledStart"
              name="scheduledStart"
              type="datetime-local"
              value={scheduledStart}
              onChange={(event) => setScheduledStart(event.target.value)}
            />
          </Field>

          <Field
            label="Estimate (minutes)"
            htmlFor="estimateMinutes"
            hint="Sets the calendar event length until the real clock-out lands."
          >
            <Input
              id="estimateMinutes"
              name="estimateMinutes"
              type="number"
              min={1}
              step={15}
              placeholder="120"
            />
          </Field>

          <Field label="Techs required" htmlFor="techsRequired">
            <Input
              id="techsRequired"
              name="techsRequired"
              type="number"
              min={1}
              max={20}
              defaultValue={1}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope of work</CardTitle>
          <CardDescription>
            Markdown. A project&rsquo;s general scope is shown above this on the
            job page. Checklist lines become tickable for the tech.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            name="scopeOfWork"
            rows={6}
            placeholder={"- [ ] Swap the failed switch\n- [ ] Label all patch leads"}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="breakPaid"
              defaultChecked={breakPaidByDefault}
              disabled={Boolean(selectedProject)}
              className="size-5 accent-[var(--color-primary)]"
            />
            Breaks are paid
            {selectedProject ? (
              <span className="text-xs text-muted-foreground">
                (inherited from the project)
              </span>
            ) : null}
          </label>
        </CardContent>
      </Card>

      {canAssign ? (
        <Card>
          <CardHeader>
            <CardTitle>Assign techs</CardTitle>
            <CardDescription>
              Pay rates resolve automatically from project, client and personal
              defaults. The lead owns the merged Work Performed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {techs.map((tech) => {
              const checked = assignees.includes(tech.id);
              return (
                <div
                  key={tech.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="assigneeIds"
                      value={tech.id}
                      checked={checked}
                      onChange={() => toggleAssignee(tech.id)}
                      className="size-5 accent-[var(--color-primary)]"
                    />
                    <span className="truncate">{tech.name}</span>
                    <Badge variant="neutral">{tech.baseRole}</Badge>
                  </label>

                  {checked ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="radio"
                        name="leadId"
                        value={tech.id}
                        checked={effectiveLead === tech.id}
                        onChange={() => setLeadId(tech.id)}
                        className="size-4 accent-[var(--color-primary)]"
                      />
                      Lead
                    </label>
                  ) : null}
                </div>
              );
            })}

            {multiTechNoSupervisor ? (
              <div className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-xs text-warning ring-1 ring-inset ring-warning/30">
                <Info className="mt-0.5 size-4 shrink-0" />
                More than one tech is assigned and none of them is a supervisor.
                That is allowed, but one of them is now the lead by default —
                check it is the right person.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {needsApproval ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-sm text-warning ring-1 ring-inset ring-warning/30">
          <Info className="mt-0.5 size-4 shrink-0" />
          This job was not scheduled by a supervisor, so it will be created as
          <strong className="mx-1">Pending approval</strong>. You can start work
          on it straight away — approval catches up afterwards.
        </div>
      ) : null}

      <FormStatus
        state={state as SaveState}
        pending={pending}
        label="Create job"
        size="md"
      />
    </form>
  );
}
