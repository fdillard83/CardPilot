import { useMemo, useState } from "react";
import { helpArticles, helpCategories, type HelpCategory } from "./help-content";

export function HelpCenter({ onStartGuide, onNavigate, onRestoreChecklist, requestedArticle }: {
  onStartGuide: () => void;
  onNavigate: (view: "scan" | "collection" | "account") => void;
  onRestoreChecklist: () => void;
  requestedArticle?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | HelpCategory>("All");
  const [selectedId, setSelectedId] = useState(requestedArticle ?? "welcome");

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();
    return helpArticles.filter((article) => {
      if (category !== "All" && article.category !== category) return false;
      if (!search) return true;
      return [article.title, article.summary, article.category, ...article.sections.flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.bullets ?? [])])]
        .join(" ").toLowerCase().includes(search);
    });
  }, [category, query]);
  const selected = helpArticles.find((article) => article.id === selectedId) ?? matches[0] ?? helpArticles[0];
  return <section className="help-center" aria-labelledby="help-center-title">
    <header className="help-center-hero">
      <div><span>CardPilot Help Center</span><h1 id="help-center-title">Learn CardPilot at your pace.</h1><p>Search the user manual, find quick answers, or restart the optional guided setup.</p></div>
      <div className="help-center-actions"><button className="primary-action" type="button" onClick={onStartGuide}>Start guided setup</button><button type="button" onClick={onRestoreChecklist}>Restore checklist</button><button type="button" onClick={() => onNavigate("scan")}>Identify a card</button><button type="button" onClick={() => onNavigate("collection")}>Open My Collection</button></div>
    </header>
    <div className="help-search-row">
      <label><span>Search Help</span><input type="search" value={query} placeholder="Try “promotion fees” or “saved value”" onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="help-category-tabs" aria-label="Help categories">{helpCategories.map((item) => <button className={category === item ? "active" : ""} type="button" key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    </div>
    <div className="help-center-layout">
      <aside aria-label="Help articles">
        <strong>{matches.length} article{matches.length === 1 ? "" : "s"}</strong>
        <nav>{matches.map((article) => <button className={selected.id === article.id ? "active" : ""} type="button" key={article.id} onClick={() => setSelectedId(article.id)}><span>{article.category}</span><strong>{article.title}</strong><small>{article.summary}</small></button>)}</nav>
        {matches.length === 0 && <p>No Help articles match that search. Try fewer words or choose All.</p>}
      </aside>
      <article className="help-article">
        <span>{selected.category}</span><h2>{selected.title}</h2><p className="help-article-summary">{selected.summary}</p>
        {selected.sections.map((section) => <section key={section.heading}><h3>{section.heading}</h3>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}
        <div className="help-article-footer"><strong>Still learning?</strong><span>Restart the guided setup or return to the relevant CardPilot area whenever you are ready.</span><div><button type="button" onClick={onStartGuide}>Restart guide</button><button type="button" onClick={() => onNavigate("account")}>Account settings</button></div></div>
      </article>
    </div>
  </section>;
}
