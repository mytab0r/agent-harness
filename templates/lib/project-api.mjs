// Small, dependency-free wrapper around `gh` for GitHub Issues, Projects v2,
// milestones, sub-issues and native dependencies.
//
// The wrapper is intentionally thin: every method returns the API value or
// throws an Error that includes the command and the stderr. Callers decide
// whether a missing optional capability is a warning or a failure.

import { execFileSync } from "node:child_process";

export function createGitHub({ cwd = process.cwd(), env = process.env } = {}) {
  function gh(args, { input } = {}) {
    try {
      return execFileSync("gh", args, {
        cwd,
        encoding: "utf8",
        input,
        env,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const detail = [error.stderr, error.stdout]
        .map((value) => (value ? String(value).trim() : ""))
        .filter(Boolean)
        .join("\n");
      throw new Error(`gh ${args.slice(0, 4).join(" ")} failed: ${detail || error.message}`);
    }
  }

  function ghJson(args, options) {
    const output = gh(args, options);
    return output ? JSON.parse(output) : null;
  }

  function graphql(query, variables = {}) {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === "number") args.push("-F", `${key}=${value}`);
      else args.push("-f", `${key}=${String(value)}`);
    }
    return ghJson(args);
  }

  function labelCreate(name, { color = "ededed", description = "" } = {}) {
    return gh(["label", "create", name, "--color", color, "--description", description, "--force"]);
  }

  function issueList({ state = "all", limit = 1000 } = {}) {
    return (
      ghJson([
        "issue",
        "list",
        "--state",
        state,
        "--limit",
        String(limit),
        "--json",
        "number,title,body,state,labels,milestone,createdAt,closedAt,url,assignees",
      ]) ?? []
    );
  }

  function issueView(number) {
    return ghJson([
      "issue",
      "view",
      String(number),
      "--json",
      "number,title,body,state,labels,milestone,createdAt,closedAt,url,assignees",
    ]);
  }

  function issueCreate({ title, body, labels = [], milestone }) {
    const args = ["issue", "create", "--title", title, "--body-file", "-"];
    for (const label of labels) args.push("--label", label);
    if (milestone) args.push("--milestone", milestone);
    const output = gh(args, { input: body });
    const match = /(https:\/\/\S+\/issues\/(\d+))/.exec(output);
    if (!match) throw new Error(`could not parse the created issue URL from: ${output}`);
    return { number: Number(match[2]), url: match[1] };
  }

  function issueEdit(number, { title, body, labels = [], milestone, removeLabels = [] }) {
    const args = ["issue", "edit", String(number)];
    if (title) args.push("--title", title);
    if (body !== undefined) args.push("--body-file", "-");
    for (const label of labels) args.push("--add-label", label);
    for (const label of removeLabels) args.push("--remove-label", label);
    if (milestone) args.push("--milestone", milestone);
    return gh(args, body !== undefined ? { input: body } : undefined);
  }

  function issueReopen(number) {
    return gh(["issue", "reopen", String(number)]);
  }

  function issueClose(number, { reason = "completed" } = {}) {
    return gh(["issue", "close", String(number), "--reason", reason]);
  }

  function issueComment(number, body) {
    return gh(["issue", "comment", String(number), "--body-file", "-"], { input: body });
  }

  function repoView() {
    return ghJson(["repo", "view", "--json", "nameWithOwner,owner"]);
  }

  function projectView(owner, number) {
    return ghJson([
      "project",
      "view",
      String(number),
      "--owner",
      owner,
      "--format",
      "json",
    ]);
  }

  function projectFields(owner, number) {
    return (
      ghJson([
        "project",
        "field-list",
        String(number),
        "--owner",
        owner,
        "--limit",
        "100",
        "--format",
        "json",
      ])?.fields ?? []
    );
  }

  function projectItems(owner, number, limit = 1000) {
    return (
      ghJson([
        "project",
        "item-list",
        String(number),
        "--owner",
        owner,
        "--limit",
        String(limit),
        "--format",
        "json",
      ])?.items ?? []
    );
  }

  function projectAddItem(owner, number, url) {
    return ghJson([
      "project",
      "item-add",
      String(number),
      "--owner",
      owner,
      "--url",
      url,
      "--format",
      "json",
    ]);
  }

  function projectEditField({ projectId, itemId, fieldId, value, kind }) {
    const args = [
      "project",
      "item-edit",
      "--id",
      itemId,
      "--project-id",
      projectId,
      "--field-id",
      fieldId,
    ];
    if (kind === "single-select") args.push("--single-select-option-id", value);
    else if (kind === "number") args.push("--number", String(value));
    else if (kind === "date") args.push("--date", String(value));
    else args.push("--text", String(value));
    return gh(args);
  }

  function milestones(repo) {
    const output = gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/milestones?state=all&per_page=100`,
    ]);
    const pages = output ? JSON.parse(output) : [];
    return pages.flat();
  }

  function milestoneCreate(repo, { title, due, description = "" }) {
    const args = [
      "api",
      `repos/${repo}/milestones`,
      "-f",
      `title=${title}`,
      "-f",
      `due_on=${due}T00:00:00Z`,
    ];
    if (description) args.push("-f", `description=${description}`);
    return ghJson(args);
  }

  function issueNodeId(owner, name, number) {
    const result = graphql(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) { id }
        }
      }`,
      { owner, name, number },
    );
    return result?.data?.repository?.issue?.id ?? null;
  }

  function issueTypes(owner, name) {
    const result = graphql(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issueTypes(first: 20) { nodes { id name } }
        }
      }`,
      { owner, name },
    );
    return result?.data?.repository?.issueTypes?.nodes ?? [];
  }

  function setIssueType(issueId, issueTypeId) {
    return graphql(
      `mutation($issueId: ID!, $issueTypeId: ID!) {
        updateIssueIssueType(input: { issueId: $issueId, issueTypeId: $issueTypeId }) {
          issue { id }
        }
      }`,
      { issueId, issueTypeId },
    );
  }

  function addSubIssue(parentId, childId) {
    return graphql(
      `mutation($parent: ID!, $child: ID!) {
        addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
          issue { id }
        }
      }`,
      { parent: parentId, child: childId },
    );
  }

  function addBlockedBy(issueId, blockingIssueId) {
    return graphql(
      `mutation($issue: ID!, $blocking: ID!) {
        addBlockedBy(input: { issueId: $issue, blockingIssueId: $blocking }) {
          issue { id }
        }
      }`,
      { issue: issueId, blocking: blockingIssueId },
    );
  }

  return {
    gh,
    ghJson,
    graphql,
    labelCreate,
    issueList,
    issueView,
    issueCreate,
    issueEdit,
    issueReopen,
    issueClose,
    issueComment,
    repoView,
    projectView,
    projectFields,
    projectItems,
    projectAddItem,
    projectEditField,
    milestones,
    milestoneCreate,
    issueNodeId,
    issueTypes,
    setIssueType,
    addSubIssue,
    addBlockedBy,
  };
}
