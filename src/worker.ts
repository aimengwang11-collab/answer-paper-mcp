/**
 * Cloudflare Workers entry. The HTML module is written by `scripts/build.mjs`
 * from the same sheet the Node server serves at `/preview`.
 */
import { createPaperFetch } from "./http.js";
import { PAPER_HTML } from "./generated/paper-html.js";

const fetchPaper = createPaperFetch(PAPER_HTML);

export default {
  fetch(request: Request, env: unknown): Promise<Response> {
    return fetchPaper(request, env);
  },
};
