import { spaceMetadata } from "./spaceConfig";
import { recordHook, FlatfileRecord } from "@flatfile/plugin-record-hook";
import { Client, FlatfileEvent } from "@flatfile/listener";
import api from "@flatfile/api";
import axios from "axios";

const webhookReceiver = process.env.WEBHOOK_SITE_URL || "YOUR_WEBHOOK_URL";

export default function flatfileEventListener(listener: Client) {
  // Log all events
  listener.on("**", (event: FlatfileEvent) => {
    console.log(`Received event: ${event.topic}`);
  });

  listener
    .filter({ job: "space:configure" })
    .on("job:ready", async (event: FlatfileEvent) => {
      const { spaceId, environmentId, jobId } = event.context;
      try {
        await api.jobs.ack(jobId, {
          info: "Getting started.",
          progress: 10,
        });

        await api.workbooks.create({
          spaceId,
          environmentId,
          name: "All Data",
          labels: ["pinned"],
          sheets: [
            {
              name: "Contacts",
              slug: "contacts",
              fields: [
                {
                  key: "firstName",
                  type: "string",
                  label: "First Name",
                },
                {
                  key: "lastName",
                  type: "string",
                  label: "Last Name",
                },
                {
                  key: "email",
                  type: "string",
                  label: "Email",
                },
              ],
            },
            {
              name: "Sheet 2",
              slug: "sheet2",
              fields: [
                {
                  key: "firstName",
                  type: "string",
                  label: "First Name",
                },
                {
                  key: "lastName",
                  type: "string",
                  label: "Last Name",
                },
                {
                  key: "email",
                  type: "string",
                  label: "Email",
                },
              ],
            },
          ],
          actions: [
            {
              operation: "submitAction",
              mode: "foreground",
              label: "Submit foreground",
              description: "Submit data to webhook.site",
              primary: true,
            },
          ],
        });

        await api.spaces.update(spaceId, {
          environmentId,
          metadata: spaceMetadata,
        });

        await api.jobs.complete(jobId, {
          outcome: {
            message: "Your Space was created. Let's get started.",
            acknowledge: true,
          },
        });
      } catch (error) {
        console.error("Error:", error.stack);

        await api.jobs.fail(jobId, {
          outcome: {
            message: "Creating a Space encountered an error. See Event Logs.",
            acknowledge: true,
          },
        });
      }
    });

  listener.use(
    recordHook("contacts", (record: FlatfileRecord) => {
      const value = record.get("firstName");
      if (typeof value === "string") {
        record.set("firstName", value.toLowerCase());
      } else {
        record.addError("firstName", "Invalid first name");
      }

      const email = record.get("email") as string;
      const validEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!validEmailAddress.test(email)) {
        console.log("Invalid email address");
        record.addError("email", "Invalid email address");
      }

      return record;
    }),
  );

  listener
    .filter({ job: "workbook:submitAction" })
    .on("job:ready", async (event: FlatfileEvent) => {
      const { context, payload } = event;
      const { jobId, workbookId } = context;

      try {
        await api.jobs.ack(jobId, {
          info: "Starting job to submit action to webhook.site",
          progress: 10,
        });

        const job = await api.jobs.get(jobId);
        const priority = job.data.input["string"];
        console.log("Priority: ", priority);

        const { data: sheets } = await api.sheets.list({ workbookId });
        const records: { [name: string]: any } = {};
        for (const [index, sheet] of sheets.entries()) {
          records[`Sheet[${index}]`] = await api.records.get(sheet.id);
        }

        console.log(JSON.stringify(records, null, 2));

        const response = await axios.post(
          webhookReceiver,
          {
            ...payload,
            method: "axios",
            sheets,
            records,
            priority,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        if (response.status !== 200) {
          throw new Error("Failed to submit data to webhook.site");
        }

        await api.jobs.complete(jobId, {
          outcome: {
            message: `Data was successfully submitted to Webhook.site. Go check it out at ${webhookReceiver}.`,
          },
        });
      } catch (error) {
        console.log(`Webhook.site error: ${JSON.stringify(error, null, 2)}`);
        await api.jobs.fail(jobId, {
          outcome: {
            message: `This job failed. Check your ${webhookReceiver}.`,
          },
        });
      }
    });
}
