/**
 * Jira search proxy — mirrors the auth pattern from the existing jira-dashboard project.
 * Uses VITE_JIRA_EMAIL, VITE_JIRA_API_TOKEN, VITE_JIRA_DOMAIN (same env vars).
 */
export default async function handler(req, res) {
  const { jql, maxResults = '100', fields } = req.query;

  if (!jql) {
    return res.status(400).json({ error: 'jql param is required' });
  }

  const email  = process.env.VITE_JIRA_EMAIL;
  const token  = process.env.VITE_JIRA_API_TOKEN;
  const domain = process.env.VITE_JIRA_DOMAIN;

  if (!email || !token || !domain) {
    return res.status(500).json({
      error: 'Missing env vars: VITE_JIRA_EMAIL, VITE_JIRA_API_TOKEN, VITE_JIRA_DOMAIN',
    });
  }

  const credentials = Buffer.from(`${email}:${token}`).toString('base64');

  const fieldList = fields
    ? fields.split(',')
    : ['summary', 'status', 'assignee', 'created', 'updated',
       'resolutiondate', 'issuetype', 'priority', 'project'];

  try {
    const jiraRes = await fetch(
      `https://${domain}.atlassian.net/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jql, maxResults: Number(maxResults), fields: fieldList }),
      }
    );

    const data = await jiraRes.json();
    if (!jiraRes.ok) {
      return res.status(jiraRes.status).json({ error: data });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
