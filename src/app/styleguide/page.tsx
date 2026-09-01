import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar, Button, Card, Field, Icon, Pill, Stat, TableWrap } from "@/components/ui";
import { styleguideBlocked } from "./gate";

export const metadata: Metadata = { title: "Styleguide" };

export default function StyleguidePage() {
  if (styleguideBlocked()) notFound();

  return (
    <main className="container">
      <h1>Styleguide</h1>
      <p>Living reference of every design-system primitive. Dev/preview only.</p>

      <section>
        <h2>Buttons</h2>
        <Button variant="primary">Primary</Button>{" "}
        <Button variant="secondary">Secondary</Button>{" "}
        <Button variant="danger">Danger</Button>{" "}
        <Button icon aria-label="Edit">
          <Icon name="edit" />
        </Button>{" "}
        <Button pending pendingLabel="Saving…">
          Save
        </Button>
      </section>

      <section>
        <h2>Card</h2>
        <Card>
          <Card.Head>Card head</Card.Head>
          <p>Card body content.</p>
        </Card>
      </section>

      <section>
        <h2>Field</h2>
        <Field label="Name">
          <input type="text" />
        </Field>
        <Field label="Email" error="Email is required">
          <input type="email" />
        </Field>
      </section>

      <section>
        <h2>Pill</h2>
        <Pill tone="role">role</Pill> <Pill tone="admin">admin</Pill>{" "}
        <Pill tone="on">on</Pill> <Pill tone="off">off</Pill>{" "}
        <Pill tone="new">new</Pill> <Pill tone="update">update</Pill>{" "}
        <Pill tone="error">error</Pill> <Pill tone="status-present">present</Pill>{" "}
        <Pill tone="status-excused">excused</Pill>{" "}
        <Pill tone="status-optional">optional</Pill>{" "}
        <Pill tone="status-absent">absent</Pill>
      </section>

      <section>
        <h2>Avatar</h2>
        <Avatar initials="ST" role="student" /> <Avatar initials="MT" role="mentor" />{" "}
        <Avatar initials="AD" role="admin" />
      </section>

      <section>
        <h2>Stat</h2>
        <Stat label="Total hours" value="128" />
        <Stat label="Goal progress" value="64%" bar={0.64} />
      </section>

      <section>
        <h2>TableWrap</h2>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ada Lovelace</td>
                <td>Mentor</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </section>
    </main>
  );
}
