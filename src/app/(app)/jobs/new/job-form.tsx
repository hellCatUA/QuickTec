"use client";

import { Info, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { HoursPicker, Stepper } from "@/components/ui/stepper";
import { createJob, type ActionResult } from "../actions";
import { SitePicker, type CustomerOption } from "./site-picker";

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
  breakPaid: boolean;
};
type Tech = { id: string; name: string; baseRole: string };

export function JobForm({
  canAssign,
  needsApproval,
  clients,
  sites,
  projects,
  techs,
  customers,
  globalNextSequence,
  breakPaidByDefault,
}: {
  canAssign: boolean;
  needsApproval: boolean;
  clients: Client[];
  sites: Site[];
  projects: Project[];
  techs: Tech[];
  customers: CustomerOption[];
  globalNextSequence: number;
  breakPaidByDefault: boolean;
}) {
  const router = useRouter();

  // Nothing is preselected. A company chosen for you is a company nobody
  // checked, and this form files the work order under it.
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [techsRequired, setTechsRequired] = useState(1);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [breakPaidChoice, setBreakPaidChoice] = useState<boolean | null>(null);

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
  const projectBreakPaid = selectedProject?.breakPaid ?? breakPaidByDefault;

  // Follows the project until somebody sets it by hand, after which their
  // choice stands — changing project must not silently undo a deliberate
  // override. Derived rather than synced through an effect, so there is no
  // render where the two disagree.
  const breakPaid = breakPaidChoice ?? projectBreakPaid;

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

  const unassigned = techs.filter((tech) => !assignees.includes(tech.id));

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
            label="Representing company"
            htmlFor="clientId"
            hint="Who dispatched the work and pays for it. Not the customer whose site you visit."
          >
            <Combobox
              id="clientId"
              name="clientId"
              value={clientId}
              onChange={(next) => {
                setClientId(next);
                setProjectId("");
              }}
              placeholder="Search companies…"
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
            />
          </Field>

          <Field
            label="Project"
            htmlFor="projectId"
            hint={
              !clientId
                ? "Pick a company first — projects belong to one."
                : availableProjects.length === 0
                  ? "No active projects for this company. The job uses the yearly counter."
                  : "Leave it empty to use the yearly counter and 0000 as the project ref."
            }
          >
            <Combobox
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={setProjectId}
              disabled={!clientId || availableProjects.length === 0}
              placeholder={
                availableProjects.length === 0
                  ? "No project"
                  : "Search projects…"
              }
              options={availableProjects.map((project) => ({
                value: project.id,
                label: project.name,
                hint: project.externalProjectId ?? undefined,
              }))}
            />
          </Field>

          <Field
            label="Site"
            htmlFor="siteId"
            hint="Supplies the customer and the address on the report. Not there yet? Search for the number and add it."
            className="sm:col-span-2"
          >
            <SitePicker
              sites={sites}
              customers={customers}
              value={siteId}
              onChange={setSiteId}
            />
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
        <CardContent className="grid gap-4 sm:grid-cols-2">
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
            label="Estimate"
            htmlFor="estimateMinutes"
            hint="Sets the calendar event length until the real clock-out lands."
          >
            <HoursPicker
              name="estimateMinutes"
              minutes={estimateMinutes}
              onChange={setEstimateMinutes}
            />
          </Field>

          <Field label="Techs required" htmlFor="techsRequired">
            <Stepper
              name="techsRequired"
              value={techsRequired}
              onChange={setTechsRequired}
              min={1}
              max={20}
              presets={[2, 3]}
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

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="breakPaid"
                checked={breakPaid}
                onChange={(event) => setBreakPaidChoice(event.target.checked)}
                className="size-5 accent-[var(--color-primary)]"
              />
              Breaks are paid
            </label>

            {/* The project supplies the default, but a single job can differ —
                a long day where breaks are covered on work that normally does
                not. Saying which it is beats disabling the box. */}
            {selectedProject ? (
              <span className="text-xs text-muted-foreground">
                {breakPaid === projectBreakPaid
                  ? `Same as the ${selectedProject.name} project.`
                  : `Overriding the ${selectedProject.name} project, which says ${projectBreakPaid ? "paid" : "unpaid"}.`}
              </span>
            ) : null}
          </div>
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
            {assignees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody yet. A job can be planned now and crewed later.
              </p>
            ) : null}

            {assignees.map((id) => {
              const tech = techs.find((entry) => entry.id === id);
              if (!tech) return null;

              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                >
                  <input type="hidden" name="assigneeIds" value={id} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {tech.name}
                  </span>
                  <Badge variant="neutral">{tech.baseRole}</Badge>

                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name="leadId"
                      value={id}
                      checked={effectiveLead === id}
                      onChange={() => setLeadId(id)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Lead
                  </label>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${tech.name}`}
                    onClick={() => toggleAssignee(id)}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}

            {unassigned.length > 0 ? (
              <Combobox
                id="assignee-search"
                value=""
                onChange={(id) => {
                  if (id) toggleAssignee(id);
                }}
                placeholder="Search people to add…"
                allowClear={false}
                options={unassigned.map((tech) => ({
                  value: tech.id,
                  label: tech.name,
                  hint: tech.baseRole.toLowerCase(),
                }))}
              />
            ) : null}

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
