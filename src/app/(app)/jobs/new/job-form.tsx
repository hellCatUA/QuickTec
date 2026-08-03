"use client";

import { FileText, Info, X } from "lucide-react";
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
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormStatus, type SaveState } from "@/components/ui/form-status";
import { HoursPicker, Stepper } from "@/components/ui/stepper";
import { createJob, type ActionResult } from "../actions";
import { DispatchList } from "./dispatch-list";
import { SitePicker, type SiteOption } from "./site-picker";

type Client = { id: string; name: string };
type Customer = { id: string; code: string; name: string };
type Project = {
  id: string;
  name: string;
  externalProjectId: string | null;
  clientId: string;
  clientName: string;
  customerId: string | null;
  intWoCounter: number;
  breakPaid: boolean;
  defaultJobTitle: string | null;
  defaultPayType: string | null;
  defaultPayRate: string | null;
  travelReimbursement: string | null;
  memberIds: string[];
  dispatchContacts: { id: string; label: string; name: string | null }[];
};
type Tech = { id: string; name: string; baseRole: string };
type Template = {
  id: string;
  clientId: string;
  kind: "CLIENT_WORK_ORDER" | "SIGN_OFF";
  label: string;
  isDefault: boolean;
};

export function JobForm({
  canAssign,
  needsApproval,
  clients,
  sites,
  projects,
  techs,
  customers,
  templates,
  canSetPay,
  globalNextSequence,
  breakPaidByDefault,
}: {
  canAssign: boolean;
  needsApproval: boolean;
  clients: Client[];
  sites: SiteOption[];
  projects: Project[];
  techs: Tech[];
  customers: Customer[];
  templates: Template[];
  /** Setting a rate on a job is a pay decision, not a planning one. */
  canSetPay: boolean;
  globalNextSequence: number;
  breakPaidByDefault: boolean;
}) {
  const router = useRouter();

  // Nothing is preselected. A company chosen for you is a company nobody
  // checked, and this form files the work order under it.
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [techsRequired, setTechsRequired] = useState(1);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [breakPaidChoice, setBreakPaidChoice] = useState<boolean | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [noWorkOrder, setNoWorkOrder] = useState(false);
  const [pickedTemplates, setPickedTemplates] = useState<string[] | null>(null);
  const [addedSites, setAddedSites] = useState<SiteOption[]>([]);
  const [payType, setPayType] = useState("");
  const [payRate, setPayRate] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await createJob(prev, formData);
      if (result.ok && result.id) router.push(`/jobs/${result.id}`);
      return result;
    },
    null,
  );

  const selectedProject = projects.find((project) => project.id === projectId);

  /**
   * Choosing the project answers the company and often the customer too, which
   * is why it comes first: those three used to be filled in one at a time and
   * disagreeing with each other was possible at every step.
   */
  function chooseProject(next: string) {
    setProjectId(next);
    const project = projects.find((entry) => entry.id === next);
    if (!project) return;

    setClientId(project.clientId);
    if (project.customerId && project.customerId !== customerId) {
      setCustomerId(project.customerId);
      setSiteId("");
    }
    // Work inside one project is the same sentence forty times over. Anything
    // typed by hand stands: a prefill that overwrites what somebody wrote is
    // worse than no prefill.
    if (!titleTouched && project.defaultJobTitle) {
      setTitle(project.defaultJobTitle);
    }
  }

  const allSites = useMemo(
    () => [...addedSites, ...sites],
    [addedSites, sites],
  );
  const customerSites = useMemo(
    () => allSites.filter((site) => site.customer.id === customerId),
    [allSites, customerId],
  );

  const customerName =
    customers.find((customer) => customer.id === customerId)?.name ?? "";

  // Only projects belonging to the chosen client can apply — the project's own
  // counter and ID would otherwise end up on another client's work order.
  const availableProjects = useMemo(
    () =>
      clientId
        ? projects.filter((project) => project.clientId === clientId)
        : projects,
    [projects, clientId],
  );

  const projectBreakPaid = selectedProject?.breakPaid ?? breakPaidByDefault;

  // Follows the project until somebody sets it by hand, after which their
  // choice stands — changing project must not silently undo a deliberate
  // override. Derived rather than synced through an effect, so there is no
  // render where the two disagree.
  const breakPaid = breakPaidChoice ?? projectBreakPaid;

  const clientTemplates = useMemo(
    () => templates.filter((template) => template.clientId === clientId),
    [templates, clientId],
  );

  // Their defaults start ticked; once somebody touches the list their choice
  // stands, even if they then switch company and switch back.
  const chosenTemplates =
    pickedTemplates ??
    clientTemplates.filter((template) => template.isDefault).map((t) => t.id);

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

  // Says out loud what happens if the field is left alone, which is the whole
  // reason it can be left alone.
  const payFallback = selectedProject?.defaultPayType
    ? `Blank means each tech's own rate, then the project's ${selectedProject.defaultPayType.toLowerCase().replace("_", "-")} $${Number(selectedProject.defaultPayRate ?? 0).toFixed(2)}.`
    : "Blank means each tech's own rate.";

  const projectMembers = selectedProject?.memberIds ?? [];

  // People already on the project first: they are who this work is normally
  // given to, and scrolling past the whole company to find them is how the
  // wrong person ends up on a job.
  const unassigned = useMemo(() => {
    const free = techs.filter((tech) => !assignees.includes(tech.id));
    return [
      ...free.filter((tech) => projectMembers.includes(tech.id)),
      ...free.filter((tech) => !projectMembers.includes(tech.id)),
    ];
  }, [techs, assignees, projectMembers]);

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
          <Field
            label="Project"
            htmlFor="projectId"
            hint="Fills in the company and the customer. Leave it empty for one-off work — the job then uses the yearly counter and 0000 as the project ref."
            className="sm:col-span-2"
          >
            <Combobox
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={chooseProject}
              placeholder="Search projects…"
              emptyText="No project matches."
              options={availableProjects.map((project) => ({
                value: project.id,
                label: project.name,
                hint: project.externalProjectId
                  ? `${project.clientName} · ${project.externalProjectId}`
                  : project.clientName,
                keywords: project.clientName,
              }))}
            />
          </Field>

          <Field
            label="Representing company"
            htmlFor="clientId"
            hint="Who dispatched the work and pays for it."
          >
            <Combobox
              id="clientId"
              name="clientId"
              value={clientId}
              onChange={(next) => {
                setClientId(next);
                setProjectId("");
                setPickedTemplates(null);
              }}
              placeholder="Search companies…"
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
            />
          </Field>

          <Field
            label="Customer"
            htmlFor="customerId"
            hint="Whose site you visit — the brand on the door, not who pays."
          >
            <Combobox
              id="customerId"
              name="customerId"
              value={customerId}
              onChange={(next) => {
                setCustomerId(next);
                setSiteId("");
              }}
              placeholder="Search customers…"
              options={customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
                hint: customer.code,
              }))}
            />
          </Field>

          <Field
            label="Site ID"
            htmlFor="siteId"
            hint="Supplies the address on the report. Not there yet? Type the number and add it."
            className="sm:col-span-2"
          >
            <SitePicker
              sites={customerSites}
              customerId={customerId}
              customerName={customerName}
              value={siteId}
              onChange={setSiteId}
              onCreated={(site) => setAddedSites((current) => [site, ...current])}
            />
          </Field>

          <Field label="Job title" htmlFor="title" className="sm:col-span-2">
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleTouched(true);
              }}
              placeholder="Switch replacement"
              required
              autoComplete="off"
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
        <CardContent>
          <Textarea
            name="scopeOfWork"
            rows={6}
            placeholder={"- [ ] Swap the failed switch\n- [ ] Label all patch leads"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paperwork</CardTitle>
          <CardDescription>
            The representing company&rsquo;s own work order and sign-off sheet.
            Files are attached from the job page once it exists — by whoever has
            them, which is often the tech on the morning.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {clientTemplates.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Their standing forms
              </span>
              {clientTemplates.map((template) => (
                <label
                  key={template.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="templateIds"
                    value={template.id}
                    checked={chosenTemplates.includes(template.id)}
                    onChange={(event) =>
                      setPickedTemplates(
                        event.target.checked
                          ? [...chosenTemplates, template.id]
                          : chosenTemplates.filter((id) => id !== template.id),
                      )
                    }
                    className="size-5 accent-[var(--color-primary)]"
                  />
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {template.label}
                  </span>
                  <Badge variant="neutral">
                    {template.kind === "SIGN_OFF" ? "Sign-off" : "Work order"}
                  </Badge>
                </label>
              ))}
            </div>
          ) : clientId ? (
            <p className="text-sm text-muted-foreground">
              This company has no standing forms saved. Add their sign-off sheet
              in the directory and every job for them starts with it attached.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a representing company to see the forms saved against them.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="noWorkOrder"
              checked={noWorkOrder}
              onChange={(event) => setNoWorkOrder(event.target.checked)}
              className="size-5 accent-[var(--color-primary)]"
            />
            No WO for this job
          </label>
          <span className="text-xs text-muted-foreground">
            Says the company issued none, so the empty slot reads as a decision
            rather than paperwork nobody chased. Attaching one later clears it.
          </span>
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
                  {projectMembers.includes(id) ? (
                    <Badge variant="primary">On the project</Badge>
                  ) : null}
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
                placeholder={
                  selectedProject
                    ? "Search — people on the project come first…"
                    : "Search people to add…"
                }
                allowClear={false}
                options={unassigned.map((tech) => ({
                  value: tech.id,
                  label: tech.name,
                  hint: projectMembers.includes(tech.id)
                    ? `on the project · ${tech.baseRole.toLowerCase()}`
                    : tech.baseRole.toLowerCase(),
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

      <Card>
        <CardHeader>
          <CardTitle>Dispatch</CardTitle>
          <CardDescription>
            Numbers a tech may need mid-job, for this job alone. Their own
            supervisor is always shown first and does not need adding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DispatchList inherited={selectedProject?.dispatchContacts ?? []} />
        </CardContent>
      </Card>

      {canSetPay ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay</CardTitle>
            <CardDescription>
              For this job only. Left blank, everybody on it keeps their own
              rate — or the project&rsquo;s default where they have none.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Pay type"
              htmlFor="payType"
              hint={payFallback}
            >
              <Select
                id="payType"
                name="payType"
                value={payType}
                onChange={(event) => setPayType(event.target.value)}
              >
                <option value="">— leave as it resolves —</option>
                <option value="HOURLY">Hourly</option>
                <option value="FLAT">Flat rate</option>
                <option value="NON_BILLABLE">Non-billable</option>
              </Select>
            </Field>

            <Field label="Pay rate ($)" htmlFor="payRate">
              <Input
                id="payRate"
                name="payRate"
                type="number"
                step="0.01"
                min={0}
                value={payRate}
                onChange={(event) => setPayRate(event.target.value)}
                placeholder={payType ? "Required with a pay type" : "Leave blank"}
              />
            </Field>

            <Field
              label="Travel reimbursement ($)"
              htmlFor="travelReimbursement"
              hint={
                selectedProject?.travelReimbursement
                  ? `Blank uses the project's $${Number(selectedProject.travelReimbursement).toFixed(2)}.`
                  : "Money the customer allocates for travel. Separate from mileage."
              }
              className="sm:col-span-2"
            >
              <Input
                id="travelReimbursement"
                name="travelReimbursement"
                type="number"
                step="0.01"
                min={0}
                placeholder="Leave blank for the project default"
              />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Miscellaneous</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="breakPaid"
              checked={breakPaid}
              onChange={(event) => setBreakPaidChoice(event.target.checked)}
              className="size-5 accent-[var(--color-primary)]"
            />
            Paid Breaks
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
        </CardContent>
      </Card>

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
