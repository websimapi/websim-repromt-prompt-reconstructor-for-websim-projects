import { chunkText } from './utils.js';

let conversationHistory = [];

export async function generateReprompt(context, opts) {
  const { target = 'webapp', verbosity = 'balanced', includeAcceptance = false } = opts || {};

  const roleGuide = [
    `You are an expert prompt engineer and creative technical writer.`,
    `Task: Merge a project's entire prompt history into ONE definitive, richly detailed prompt that allows a new model to faithfully recreate the experience.`,
    `Audience: A state-of-the-art generative model.`,
    `Constraints:`,
    `- Be explicit about visual style, interaction model, content structure, behaviors, data flows, states, and constraints.`,
    `- Infer stable, consistent intent across revisions. Resolve contradictions by preferring the most recent intent while preserving important specifics from earlier prompts.`,
    `- Include precise UI/UX details (layout, components, transitions, states).`,
    `- Include content schema and example content if appropriate.`,
    `- Avoid mentioning "revisions", "history", or "prior prompts". Output as a single authoritative brief.`,
    `Customization knobs: target=${target}, verbosity=${verbosity}.`,
    includeAcceptance ? `- Add a short "Acceptance Criteria" section with objective checks.` : null,
  ].filter(Boolean).join('\n');

  const projectHeader = [
    `Project: ${context.project.title || '(Untitled)'}`,
    context.project.description ? `Description: ${context.project.description}` : null,
    context.project.created_by?.username ? `Author: @${context.project.created_by.username}` : null,
    `Stats: likes=${context.project.stats?.likes ?? 0}, views=${context.project.stats?.views ?? 0}, comments=${context.project.stats?.comments ?? 0}`,
  ].filter(Boolean).join('\n');

  const revs = context.revisions || [];
  const revLines = [];
  for (const r of revs) {
    const head = `v${r.version} (${new Date(r.created_at).toISOString()})` +
      (r.site_title ? ` • title: "${r.site_title}"` : '') +
      (r.site_model ? ` • model: ${r.site_model}` : '');
    revLines.push(`- ${head}`);
    if (r.prompt_text) {
      const chunks = chunkText(r.prompt_text, 1400);
      chunks.forEach((c, i) => {
        revLines.push(i === 0 ? `  prompt: ${c}` : `  prompt(cont'd): ${c}`);
      });
    } else {
      revLines.push(`  prompt: (none)`);
    }
    if (r.attachments?.length) {
      const att = r.attachments.slice(0, 8).map(a => `${a.mediaType}:${a.filename || a.id}`).join(', ');
      revLines.push(`  attachments: ${att}`);
    }
    if (r.asset_hints?.length) {
      const im = r.asset_hints.filter(a => a.content_type?.startsWith('image')).length;
      const au = r.asset_hints.filter(a => a.content_type?.startsWith('audio')).length;
      const sfx = r.asset_hints.filter(a => a.content_type?.includes('mpeg') || a.content_type?.includes('wav')).length;
      const md = r.asset_hints.filter(a => a.content_type?.includes('model')).length;
      revLines.push(`  assets: images=${im}, audio=${au}, sfx=${sfx}, models=${md}`);
    }
  }

  const content = [
    projectHeader,
    '',
    'Collected Prompt History (oldest → newest):',
    ...revLines,
  ].join('\n');

  const system = roleGuide;
  const user = [
    `Synthesize one final, production-quality "${target}" prompt.`,
    verbosity === 'maximal' ? `Use exhaustive detail; anticipate edge cases; specify constraints and performance targets.` :
    verbosity === 'concise' ? `Be brief but complete; prioritize core goals and critical constraints.` :
    `Balance thoroughness and readability; include technical specifics where useful.`,
    '',
    'Input context follows:',
    '---',
    content,
    '---',
    'Return only the final prompt (and optional Acceptance Criteria if requested).',
  ].join('\n');

  const newMessage = {
    role: "user",
    content: user,
  };
  conversationHistory.push(newMessage);
  conversationHistory = conversationHistory.slice(-10);

  const completion = await websim.chat.completions.create({
    messages: [
      {
        role: "system",
        content: system,
      },
      ...conversationHistory,
    ],
  });

  const response = completion.content || '';
  conversationHistory.push({ role: 'assistant', content: response });
  conversationHistory = conversationHistory.slice(-10);

  return response.trim();
}

export async function generatePreviewImage(prompt) {
  // Use a reasonably wide preview to visualize the theme; image only.
  const result = await websim.imageGen({
    prompt,
    aspect_ratio: "16:9",
    seed: 1234,
  });
  return result.url;
}

