"use client";
import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { AudioLines, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, CirclePlus, Clapperboard, Columns3, Ellipsis, ExternalLink, File as FileIcon, FolderOpen, GripVertical, Image as ImageIcon, LayoutList, MessageSquare, Paperclip, Pencil, Play, Search, Trash2, TriangleAlert, UserRound, X } from "lucide-react";
import type { ProjectFile, Task, TaskAttachment, TaskStage, TaskWorkflowSettings } from "@/lib/api"; import type { TasksView } from "@/lib/tasks-view";
import { updateAssetFile } from "@/lib/asset-api-client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Switch } from "@/components/ui/switch";
const COLUMNS = [{ id:"TODO",label:"To Do",color:"#89909d",wip_limit:null,is_done:false},{id:"REVISIONS",label:"Revisions",color:"#ff5865",wip_limit:null,is_done:false},{id:"INTERNAL_QA",label:"Internal QA",color:"#4ba3ff",wip_limit:null,is_done:false},{id:"CLIENT",label:"Client",color:"#f4a742",wip_limit:null,is_done:false},{id:"APPROVED",label:"Approved",color:"#36d399",wip_limit:null,is_done:true}] as const;
type ColumnId=string; type DueFilter=""|"OVERDUE"|"TODAY"|"WEEK"|"NONE";
type Inspection = { kind:"task"; id:string } | { kind:"review"; fileId:string; taskId?:string };
export function TasksBoard({view,projectId=null,compact=false}:{view:TasksView;projectId?:string|null;compact?:boolean}){
 const reduceMotion=useReducedMotion();
 const [tasks,setTasks]=useState(view.tasks),[mode,setMode]=useState<"KANBAN"|"LIST">("KANBAN"),[query,setQuery]=useState(""),[client,setClient]=useState(""),[project,setProject]=useState(projectId??""),[assignee,setAssignee]=useState(""),[status,setStatus]=useState(""),[priority,setPriority]=useState(""),[due,setDue]=useState<DueFilter>(""),[editing,setEditing]=useState<Task|"new"|"stages"|null>(null),[newStage,setNewStage]=useState<string|null>(null),[over,setOver]=useState<ColumnId|null>(null),[error,setError]=useState("");
 const [inspection,setInspection]=useState<Inspection|null>(null),[inspectorPercent,setInspectorPercent]=useState(54),[attachments,setAttachments]=useState<Record<string,TaskAttachment[]>>({}),[attachmentsLoading,setAttachmentsLoading]=useState<string|null>(null);
 const splitRef=useRef<HTMLDivElement>(null);
 const columns=view.stages.length?view.stages.map(x=>({id:x.id,label:x.name,color:x.color,wip_limit:x.wip_limit,is_done:x.is_done})):COLUMNS; const stageId=(t:Task)=>t.task_stage_id??normal(t.status);
 const [files,setFiles]=useState(view.files);
 // Files carry a workspace stage, so they sit in the same columns as tasks.
 const shownFiles=files.filter(f=>(!projectId||f.project_id===projectId)&&(!project||f.project_id===project)&&(!client||f.client_team_id===client)&&(!query.trim()||f.file.name.toLowerCase().includes(query.trim().toLowerCase()))&&(!status||f.task_stage_id===status));
 async function moveFile(id:string,stageId:string){setError("");const before=files;setFiles(xs=>xs.map(x=>x.id===id?{...x,task_stage_id:stageId}:x));try{await updateAssetFile(view.workspaceId!,id,{task_stage_id:stageId})}catch(e){setFiles(before);setError(msg(e))}}
 const projectMap=useMemo(()=>new Map(view.projects.map(x=>[x.id,x])),[view.projects]),clientMap=useMemo(()=>new Map(view.clients.map(x=>[x.id,x.name])),[view.clients]); const projects=view.projects.filter(x=>!client||x.client_team_id===client);
 const filtered=tasks.filter(t=>{const p=t.project_id?projectMap.get(t.project_id):null,c=t.client_team_id??p?.client_team_id??null,hay=`${t.title} ${t.description??""} ${p?.name??""} ${t.assignees.map(x=>x.name).join(" ")}`.toLowerCase();return(!projectId||t.project_id===projectId)&&(!query.trim()||hay.includes(query.trim().toLowerCase()))&&(!client||c===client)&&(!project||t.project_id===project)&&(!assignee||t.assignees.some(x=>x.id===assignee))&&(!status||stageId(t)===status)&&(!priority||t.priority===priority)&&matchesDue(t.due_at,due)}).sort((a,b)=>a.sort_order-b.sort_order||b.updated_at.localeCompare(a.updated_at));
 const itemCount=filtered.length+shownFiles.length,doneStages=new Set(columns.filter(x=>x.is_done).map(x=>x.id)),doneCount=filtered.filter(x=>doneStages.has(stageId(x))).length+shownFiles.filter(x=>x.task_stage_id&&doneStages.has(x.task_stage_id)).length,progress=itemCount?Math.round(doneCount/itemCount*100):0;
 const visibleAssignees=Array.from(new Map(filtered.flatMap(x=>x.assignees).map(x=>[x.id,x])).values()).slice(0,3);
 const inspectedTask=inspection?.kind==="task"?tasks.find(x=>x.id===inspection.id)??null:inspection?.taskId?tasks.find(x=>x.id===inspection.taskId)??null:null;
 const inspectedFile=inspection?.kind==="review"?files.find(x=>x.file.id===inspection.fileId)??null:null;
 const fileBySourceId=useMemo(()=>new Map(files.map(file=>[file.file.id,file])),[files]);
 async function patchTask(id:string,payload:Record<string,unknown>){setError("");const before=tasks;setTasks(xs=>xs.map(x=>x.id===id?{...x,...payload,updated_at:new Date().toISOString()} as Task:x));try{const saved=await request<Task>(view.workspaceId,id,"PATCH",payload);setTasks(xs=>xs.map(x=>x.id===id?saved:x))}catch(e){setTasks(before);setError(msg(e))}}
 async function drop(e:DragEvent,target:ColumnId){e.preventDefault();setOver(null);const fileId=e.dataTransfer.getData("text/file");if(fileId){await moveFile(fileId,target);return}const id=e.dataTransfer.getData("text/task");if(id){const col=columns.find(x=>x.id===target),count=filtered.filter(x=>stageId(x)===target&&x.id!==id).length;if(col?.wip_limit&&count>=col.wip_limit&&view.workflowSettings.wip_warning&&!confirm(`${col.label} has reached its WIP limit. Move anyway?`))return;await patchTask(id,{task_stage_id:target,sort_order:count})}}
 async function inspectTask(task:Task){
  setInspection({kind:"task",id:task.id});
  if(!view.workspaceId||Object.hasOwn(attachments,task.id))return;
  setAttachmentsLoading(task.id);
  try{
   const response=await fetch(`/api/workspaces/${view.workspaceId}/tasks/${task.id}/attachments/`,{credentials:"include"});
   if(!response.ok)throw Error(`Could not load attachments (${response.status}).`);
   const rows=await response.json() as TaskAttachment[];
   setAttachments(current=>({...current,[task.id]:rows}));
  }catch(e){setAttachments(current=>({...current,[task.id]:[]}));setError(msg(e))}
  finally{setAttachmentsLoading(current=>current===task.id?null:current)}
 }
 function inspectFile(file:ProjectFile,taskId?:string){setInspection({kind:"review",fileId:file.file.id,taskId})}
 function resizeInspector(event:ReactPointerEvent<HTMLButtonElement>){
  if(!event.currentTarget.hasPointerCapture(event.pointerId)||!splitRef.current)return;
  const bounds=splitRef.current.getBoundingClientRect();
  setInspectorPercent(Math.min(70,Math.max(35,(event.clientX-bounds.left)/bounds.width*100)));
 }
 function resizeInspectorWithKeys(event:ReactKeyboardEvent<HTMLButtonElement>){
  if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
  event.preventDefault();
  setInspectorPercent(value=>Math.min(70,Math.max(35,value+(event.key==="ArrowLeft"?-2:2))));
 }
 async function remove(t:Task){if(!confirm(`Delete “${t.title}”?`))return;const before=tasks;setTasks(xs=>xs.filter(x=>x.id!==t.id));try{await request(view.workspaceId,t.id,"DELETE")}catch(e){setTasks(before);setError(msg(e))}}
 return <div
  ref={splitRef}
  className={`tasks-split ${inspection?"is-inspecting":""}`}
  style={{"--task-inspector-size":`${inspectorPercent}%`} as CSSProperties}
 >
  <AnimatePresence initial={false}>
   {inspection&&<motion.aside
    className="task-inspector-shell"
    initial={reduceMotion?false:{opacity:0,x:-18}}
    animate={{opacity:1,x:0}}
    exit={reduceMotion?undefined:{opacity:0,x:-18}}
    transition={reduceMotion?{duration:0}:{duration:.22,ease:[.22,1,.36,1]}}
   >
    {inspection.kind==="review"&&inspectedFile
     ? <ReviewInspector file={inspectedFile} task={inspectedTask} close={()=>setInspection(null)} back={inspectedTask?()=>setInspection({kind:"task",id:inspectedTask.id}):null}/>
     : inspectedTask
      ? <TaskInspector task={inspectedTask} view={view} columns={columns} attachments={attachments[inspectedTask.id]} loading={attachmentsLoading===inspectedTask.id} fileBySourceId={fileBySourceId} close={()=>setInspection(null)} edit={()=>setEditing(inspectedTask)} review={file=>inspectFile(file,inspectedTask.id)} patch={payload=>patchTask(inspectedTask.id,payload)}/>
      : <div className="task-inspector-missing"><p>This item is no longer available.</p><button onClick={()=>setInspection(null)}>Close</button></div>}
   </motion.aside>}
  </AnimatePresence>
  {inspection&&<button
   type="button"
   className="task-split-resizer"
   aria-label="Resize review panel"
   title="Drag to resize"
   onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)}
   onPointerMove={resizeInspector}
   onKeyDown={resizeInspectorWithKeys}
  ><span/></button>}
  <div className="tasks-board-pane">
   <div className={`tasks-page ${compact?"compact":""}`}>
    {view.notice&&<p className="tasks-notice"><TriangleAlert/>{view.notice}</p>}
    <header className={compact?"tasks-compact-head":"tasks-heading"}><div className="tasks-identity"><span className="tasks-identity-mark"><CheckCircle2/></span><div>{!compact&&<p className="eyebrow">Global task management</p>}{compact?<h2>Project tasks</h2>:<h1>Tasks</h1>}<p>{compact?`${itemCount} linked item${itemCount===1?"":"s"}`:"One production queue across every client and project."}</p></div></div><div className="tasks-board-overview" aria-label={`${progress}% complete`}><div className="tasks-stage-totals">{columns.map(col=><span key={col.id} title={`${col.label}: ${filtered.filter(x=>stageId(x)===col.id).length+shownFiles.filter(x=>x.task_stage_id===col.id).length}`}><i style={{background:col.color}}/><b>{filtered.filter(x=>stageId(x)===col.id).length+shownFiles.filter(x=>x.task_stage_id===col.id).length}</b></span>)}</div><span className="tasks-progress"><i><b style={{width:`${progress}%`}}/></i><strong>{progress}%</strong></span>{visibleAssignees.length>0&&<div className="tasks-avatars" aria-label="Assigned team members">{visibleAssignees.map(x=><span key={x.id} title={x.name}>{initials(x.name)}</span>)}</div>}</div></header>
    <div className="tasks-toolbar"><button className="tasks-new" onClick={()=>{setNewStage(null);setEditing("new")}}><CirclePlus/>New task</button><label className="tasks-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks, projects, assignees…"/></label><span className="tasks-toolbar-spacer"/><div className="tasks-view"><button className={mode==="KANBAN"?"active":""} onClick={()=>setMode("KANBAN")}><Columns3/>Kanban</button><button className={mode==="LIST"?"active":""} onClick={()=>setMode("LIST")}><LayoutList/>List</button></div></div>
    <div className="task-filterbar">{!projectId&&<><Filter label="Client" value={client} set={v=>{setClient(v);setProject("")}} options={view.clients.map(x=>[x.id,x.name])}/><Filter label="Project" value={project} set={setProject} options={projects.map(x=>[x.id,x.name])}/></>}<Filter label="Assignee" value={assignee} set={setAssignee} options={view.members.filter(x=>x.user).map(x=>[x.id,nameOf(x.user!)])}/><Filter label="Status" value={status} set={setStatus} options={columns.map(x=>[x.id,x.label])}/><Filter label="Priority" value={priority} set={setPriority} options={[["URGENT","Urgent"],["HIGH","High"],["MEDIUM","Medium"],["LOW","Low"]]}/><Filter label="Due" value={due} set={v=>setDue(v as DueFilter)} options={[["OVERDUE","Overdue"],["TODAY","Today"],["WEEK","Next 7 days"],["NONE","No due date"]]}/>{!compact&&<button className="task-customize" onClick={()=>setEditing("stages")}>Customize Stages</button>}{(client||project||assignee||status||priority||due)&&<button className="task-clear" onClick={()=>{setClient("");setProject(projectId??"");setAssignee("");setStatus("");setPriority("");setDue("")}}>Clear</button>}</div>{error&&<p className="form-error">{error}</p>}
    {mode==="KANBAN"?<div className="task-kanban" style={{gridTemplateColumns:`repeat(${columns.length}, minmax(${inspection?148:210}px, 1fr))`}}>{columns.map(col=>{const rows=filtered.filter(t=>stageId(t)===col.id),colFiles=shownFiles.filter(f=>f.task_stage_id===col.id),atLimit=Boolean(col.wip_limit&&rows.length>=col.wip_limit);return <section key={col.id} className={`task-column ${over===col.id?"over":""} ${atLimit?"at-limit":""}`} onDragOver={e=>{e.preventDefault();setOver(col.id)}} onDragLeave={()=>setOver(null)} onDrop={e=>drop(e,col.id)}><header><i style={{background:col.color}}/><strong>{col.label}</strong>{col.is_done&&<em>Done</em>}<b>{rows.length+colFiles.length}{col.wip_limit?`/${col.wip_limit}`:""}</b><button className="task-column-add" aria-label={`Add task to ${col.label}`} onClick={()=>{setNewStage(col.id);setEditing("new")}}><CirclePlus/></button></header><div>{rows.map(t=><Card key={t.id} task={t} project={t.project_id?projectMap.get(t.project_id)?.name:undefined} client={clientMap.get(t.client_team_id??"")} reduceMotion={Boolean(reduceMotion)} open={()=>void inspectTask(t)} edit={()=>setEditing(t)} remove={()=>remove(t)}/>)}{shownFiles.filter(f=>f.task_stage_id===col.id).map(f=><FileCard key={f.id} file={f} project={f.project_id?projectMap.get(f.project_id)?.name:undefined} open={()=>inspectFile(f)}/>)}{!rows.length&&!shownFiles.some(f=>f.task_stage_id===col.id)&&<p>Drop tasks or files here</p>}</div></section>})}</div>:<TaskList tasks={filtered} columns={columns} projectMap={projectMap} clientMap={clientMap} edit={task=>void inspectTask(task)} patch={patchTask} remove={remove}/>} {!filtered.length&&mode==="LIST"&&<div className="tasks-empty"><CheckCircle2/><strong>No matching tasks</strong><span>Adjust filters or create the next piece of work.</span></div>}
    <AnimatePresence>{editing==="stages"?<StageDialog view={view} close={()=>setEditing(null)}/>:editing&&<TaskDialog task={editing==="new"?null:editing} view={view} defaultProjectId={projectId} defaultStageId={newStage} close={()=>setEditing(null)} saved={t=>{setTasks(xs=>xs.some(x=>x.id===t.id)?xs.map(x=>x.id===t.id?t:x):[...xs,t]);setEditing(null)}}/>}</AnimatePresence>
   </div>
  </div>
 </div>
}
function Card({task,project,client,reduceMotion,open,edit,remove}:{task:Task;project?:string;client?:string;reduceMotion:boolean;open:()=>void;edit:()=>void;remove:()=>void}){const assignee=task.assignees[0];return <motion.article className="task-card task-work-card" layout={!reduceMotion} initial={reduceMotion?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={reduceMotion?undefined:{opacity:0,scale:.97}} whileHover={reduceMotion?undefined:{y:-2}} transition={reduceMotion?{duration:0}:{duration:.2,ease:[.22,1,.36,1]}} draggable onClick={event=>{if(!(event.target as HTMLElement).closest("button, details, summary, a, select"))open()}} onDragStart={e=>{const drag=e as unknown as DragEvent<HTMLElement>;drag.dataTransfer.setData("text/task",task.id);drag.dataTransfer.effectAllowed="move"}}><div className="task-card-top"><span><i className={`priority-dot ${task.priority.toLowerCase()}`}/>{title(task.priority)}</span><details><summary aria-label={`Actions for ${task.title}`}><Ellipsis/></summary><div><button onClick={edit}>Edit task</button><button className="danger" onClick={remove}><Trash2/>Delete</button></div></details></div><div className="task-card-main"><span className={`task-card-preview ${task.priority.toLowerCase()}`} aria-hidden="true"><Clapperboard/></span><div className="task-card-copy"><button className="task-card-title" onClick={open}>{task.title}</button><span className="task-card-assignee"><i className={assignee?"assigned":""}>{assignee?initials(assignee.name):<UserRound/>}</i>{assignee?.name||"Unassigned"}</span></div></div>{task.description&&<p>{task.description}</p>}<div className="task-rel"><span>{client||"Global"}</span>{project&&<span>{project}</span>}</div><footer><span className="task-card-kind"><GripVertical/>Task</span><time className={overdue(task.due_at)?"overdue":""}><CalendarDays/>{dateLabel(task.due_at)}</time></footer></motion.article>}
/**
 * A media card for a file staged on the board.
 *
 * Every thumbnail is the same box whatever the media's shape, so columns stay even; the
 * frame is fitted inside rather than cropped, which is what keeps a vertical cut whole.
 *
 * The badges are all real. Duration is probed when the preview is generated, the comment
 * count joins review notes through the shared `File` row, and a version number appears
 * only for a file published into a project as a media version.
 *
 * The thumbnail is the file itself only for images, which are small enough to fetch for a
 * card. Video shows the poster the worker rendered: the asset download route serves no
 * byte ranges, so a `<video>` here would pull every clip on the board down in full.
 */
function FileCard({file,project,open}:{file:ProjectFile;project?:string;open:()=>void}){
 // `file.file.id` is the `File` row, which is what review is addressed by, so the split
 // viewer opens the very same review as the Files library and the project tree do.
 const kind=file.file.mime_type.split("/")[0];
 const playable=kind==="video"||kind==="audio";
 const ready=file.file.status==="READY";
 const poster=file.poster?`/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/`:null;
 const extension=file.file.name.includes(".")?file.file.name.split(".").pop()!.toUpperCase():kind.toUpperCase();
 const Icon=kind==="video"?Clapperboard:kind==="audio"?AudioLines:kind==="image"?ImageIcon:FileIcon;
 const meta=[dateLabel(file.created_at),formatBytes(file.file.size_bytes),file.version_number?`v${file.version_number}`:null].filter(Boolean).join(" · ");
 const body=<>
  <div className={`task-file-thumb ${kind}`}>
   <Poster src={poster} fallback={<Icon/>}/>
   <em>{file.file.duration_ms?runtime(file.file.duration_ms):extension}</em>
   {file.comment_count>0&&<b className="task-file-comments"><MessageSquare/>{file.comment_count}</b>}
   {!ready&&<i className="task-file-scanning" title="Still being scanned">Scanning</i>}
  </div>
  <h4>{file.file.name}</h4>
  <p className="task-file-meta">{meta}</p>
  {project&&<span className="task-file-collection"><FolderOpen/>{project}</span>}
 </>;
 return <article className="task-card task-card-file" draggable onDragStart={e=>e.dataTransfer.setData("text/file",file.id)}>
  {playable
    ? <button type="button" className="task-file-open" onClick={open} aria-label={`Open review for ${file.file.name}`}>{body}</button>
    : <div className="task-file-open">{body}</div>}
 </article>;
}

function ReviewInspector({file,task,close,back}:{file:ProjectFile;task:Task|null;close:()=>void;back:(()=>void)|null}){
 return <div className="task-review-inspector">
  <header className="task-inspector-top">
   {back?<button type="button" className="task-inspector-back" onClick={back}><ChevronLeft/>Task</button>:<span className="task-inspector-kicker"><Play/>Review</span>}
   <div><strong title={file.file.name}>{file.file.name}</strong>{task&&<small>{task.title}</small>}</div>
   <Link href={`/review?media=${file.file.id}`} target="_top" aria-label="Open full review" title="Open full review"><ExternalLink/></Link>
   <button type="button" onClick={close} aria-label="Close review"><X/></button>
  </header>
  <div className="task-review-frame">
   <iframe src={`/review-embed?media=${file.file.id}`} title={`Review ${file.file.name}`} allow="fullscreen" allowFullScreen/>
  </div>
 </div>
}

function TaskInspector({task,view,columns,attachments,loading,fileBySourceId,close,edit,review,patch}:{
 task:Task;
 view:TasksView;
 columns:readonly {id:string;label:string;color:string}[];
 attachments:TaskAttachment[]|undefined;
 loading:boolean;
 fileBySourceId:Map<string,ProjectFile>;
 close:()=>void;
 edit:()=>void;
 review:(file:ProjectFile)=>void;
 patch:(payload:Record<string,unknown>)=>void;
}){
 const project=task.project_id?view.projects.find(item=>item.id===task.project_id):null;
 const clientId=task.client_team_id??project?.client_team_id??null;
 const client=clientId?view.clients.find(item=>item.id===clientId):null;
 const stage=columns.find(item=>item.id===(task.task_stage_id??normal(task.status)));
 return <div className="task-detail-inspector">
  <header className="task-inspector-top">
   <span className="task-inspector-kicker"><CheckCircle2/>Task</span>
   <div><strong>{task.title}</strong><small>Updated {dateLabel(task.updated_at)}</small></div>
   <button type="button" onClick={edit} aria-label="Edit task" title="Edit task"><Pencil/></button>
   <button type="button" onClick={close} aria-label="Close task"><X/></button>
  </header>
  <div className="task-detail-scroll">
   <section className="task-detail-hero">
    <span className={`task-detail-priority ${task.priority.toLowerCase()}`}><i/>{title(task.priority)} priority</span>
    <h2>{task.title}</h2>
    <p>{task.description||"No description has been added yet."}</p>
   </section>

   <section className="task-detail-grid" aria-label="Task details">
    <label><span>Status</span><select value={task.task_stage_id??normal(task.status)} onChange={event=>patch({task_stage_id:event.target.value})}>{columns.map(column=><option value={column.id} key={column.id}>{column.label}</option>)}</select></label>
    <div><span>Due date</span><strong className={overdue(task.due_at)?"overdue":""}><CalendarDays/>{dateLabel(task.due_at)}</strong></div>
    <div><span>Assignee</span><strong><i className="task-detail-avatar">{task.assignees[0]?initials(task.assignees[0].name):<UserRound/>}</i>{task.assignees[0]?.name||"Unassigned"}</strong></div>
    <div><span>Stage</span><strong><i className="task-detail-stage" style={{background:stage?.color}}/>{stage?.label||"To Do"}</strong></div>
   </section>

   <section className="task-detail-location">
    <header><span>Location</span></header>
    <div><span><small>Client</small><strong>{client?.name||"No client"}</strong></span><i>/</i><span><small>Project</small><strong>{project?.name||"No project"}</strong></span></div>
   </section>

   <section className="task-detail-attachments">
    <header><span><Paperclip/>Attachments</span><b>{attachments?.length??0}</b></header>
    {loading?<div className="task-attachment-loading"><i/><span>Loading media…</span></div>:attachments?.length?<div className="task-attachment-list">{attachments.map(attachment=>{
     const file=fileBySourceId.get(attachment.file.id);
     const kind=attachment.file.mime_type.split("/")[0];
     const playable=Boolean(file&&(kind==="video"||kind==="audio"));
     const poster=file?.poster?`/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/`:null;
     const Icon=kind==="video"?Clapperboard:kind==="audio"?AudioLines:kind==="image"?ImageIcon:FileIcon;
     return <button type="button" key={attachment.id} disabled={!playable} onClick={()=>file&&review(file)} className={playable?"is-playable":""}>
      <span className={`task-attachment-preview ${kind}`}><Poster src={poster} fallback={<Icon/>}/>{playable&&<i><Play/></i>}</span>
      <span><strong>{attachment.file.name}</strong><small>{formatBytes(attachment.file.size_bytes)} · {kind}</small></span>
      {playable&&<em>Open review</em>}
     </button>
    })}</div>:<div className="task-attachment-empty"><Paperclip/><strong>No attachments yet</strong><span>Attach media while editing this task to review it here.</span><button type="button" onClick={edit}>Edit task</button></div>}
   </section>
  </div>
 </div>
}

function TaskList({tasks,columns,projectMap,clientMap,edit,patch,remove}:{tasks:Task[];columns:readonly {id:string;label:string}[];projectMap:Map<string,TasksView["projects"][number]>;clientMap:Map<string,string>;edit:(t:Task)=>void;patch:(id:string,p:Record<string,unknown>)=>void;remove:(t:Task)=>void}){return <div className="task-table"><div className="task-tr head"><span>Task</span><span>Client</span><span>Project</span><span>Assignee</span><span>Priority</span><span>Status</span><span>Due</span><span/></div>{tasks.map(t=><div className="task-tr" key={t.id}><button onClick={()=>edit(t)}><strong>{t.title}</strong><small>{t.description||"No description"}</small></button><span>{clientMap.get(t.client_team_id??"")||"—"}</span><span>{t.project_id?projectMap.get(t.project_id)?.name:"—"}</span><span>{t.assignees[0]?.name||"Unassigned"}</span><span className={`priority-text ${t.priority.toLowerCase()}`}>{title(t.priority)}</span><select value={t.task_stage_id??normal(t.status)} onChange={e=>patch(t.id,{task_stage_id:e.target.value})}>{columns.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select><time className={overdue(t.due_at)?"overdue":""}>{dateLabel(t.due_at)}</time><button aria-label={`Delete ${t.title}`} onClick={()=>remove(t)}><Trash2/></button></div>)}</div>}
function TaskDialog({task,view,defaultProjectId,defaultStageId,close,saved}:{task:Task|null;view:TasksView;defaultProjectId:string|null;defaultStageId:string|null;close:()=>void;saved:(t:Task)=>void}){
 const initialProject=task?.project_id??defaultProjectId??"",initialClient=task?.client_team_id??view.projects.find(x=>x.id===initialProject)?.client_team_id??"";
 const [client,setClient]=useState(initialClient),[project,setProject]=useState(initialProject),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const projects=view.projects.filter(x=>!client||x.client_team_id===client),stages=view.stages.length?view.stages:COLUMNS.map((x,i)=>({id:x.id,name:x.label,color:x.color,sort_order:i,wip_limit:null,is_done:x.is_done,automation_enabled:false,task_count:0}));
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const d=new FormData(e.currentTarget),p=view.projects.find(x=>x.id===project),payload={title:String(d.get("title")),description:String(d.get("description")),client_team_id:(p?.client_team_id??client)||null,project_id:project||null,assignee_id:String(d.get("assignee")||"")||null,priority:String(d.get("priority")),task_stage_id:String(d.get("stage")),due_at:d.get("due")?new Date(String(d.get("due"))).toISOString():null};try{saved(await request<Task>(view.workspaceId,task?.id??null,task?"PATCH":"POST",payload))}catch(e){setError(msg(e));setBusy(false)}}
 return <div className="task-modal"><button className="task-modal-backdrop" onClick={close}/><form className="task-create" onSubmit={submit}><header><div><p className="eyebrow">Production work</p><h2>{task?"Edit task":"New task"}</h2></div><button type="button" onClick={close}><X/></button></header><label>Task name<input name="title" required autoFocus defaultValue={task?.title}/></label><label>Description<textarea name="description" rows={3} defaultValue={task?.description??""}/></label><div className="task-form-grid"><label>Client (optional)<select value={client} onChange={e=>{setClient(e.target.value);setProject("")}}><option value="">No client</option>{view.clients.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Project (optional)<select value={project} onChange={e=>{setProject(e.target.value);const p=view.projects.find(x=>x.id===e.target.value);if(p?.client_team_id)setClient(p.client_team_id)}}><option value="">No project</option>{projects.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Assignee<select name="assignee" defaultValue={task?.assignees[0]?.id??""}><option value="">Unassigned</option>{view.members.filter(x=>x.user).map(x=><option value={x.id} key={x.id}>{nameOf(x.user!)}</option>)}</select></label><label>Priority<select name="priority" defaultValue={task?.priority??"MEDIUM"}>{["LOW","MEDIUM","HIGH","URGENT"].map(x=><option value={x} key={x}>{title(x)}</option>)}</select></label><label>Stage<select name="stage" defaultValue={task?.task_stage_id??defaultStageId??stages[0]?.id}>{stages.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Due date<input name="due" type="datetime-local" defaultValue={inputDate(task?.due_at)}/></label></div>{error&&<p className="form-error">{error}</p>}<footer><button type="button" onClick={close}>Cancel</button><button disabled={busy}>{busy?"Saving…":task?"Save changes":"Create task"}</button></footer></form></div>
}
type StageDraft=TaskStage&{isNew?:boolean};
function StageDialog({view,close}:{view:TasksView;close:()=>void}){
 const [rows,setRows]=useState<StageDraft[]>(view.stages),[removed,setRemoved]=useState<{stage:TaskStage;replacement:string|null}[]>([]),[settings,setSettings]=useState<TaskWorkflowSettings>(view.workflowSettings),[dragged,setDragged]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const update=(id:string,patch:Partial<StageDraft>)=>setRows(xs=>xs.map(x=>x.id===id?{...x,...patch}:x));
 function add(){setRows(xs=>[...xs,{id:`new-${crypto.randomUUID()}`,name:"New Stage",color:"#8b5cf6",sort_order:xs.length,wip_limit:null,is_done:false,automation_enabled:false,task_count:0,isNew:true}])}
 function remove(stage:StageDraft){if(rows.length===1){setError("A workflow needs at least one stage.");return}let replacement:null|string=null;if(stage.task_count){const candidate=window.prompt(`Move ${stage.task_count} task${stage.task_count===1?"":"s"} to which stage? Enter the stage name.`);const target=rows.find(x=>x.id!==stage.id&&x.name.toLowerCase()===candidate?.trim().toLowerCase());if(!target){setError("Choose an existing replacement stage before deleting a stage with tasks.");return}replacement=target.id}setRows(xs=>xs.filter(x=>x.id!==stage.id));if(!stage.isNew)setRemoved(xs=>[...xs,{stage,replacement}]);setError("")}
 function dropStage(target:string){if(!dragged||dragged===target)return;setRows(xs=>{const next=[...xs],from=next.findIndex(x=>x.id===dragged),to=next.findIndex(x=>x.id===target);next.splice(to,0,next.splice(from,1)[0]);return next});setDragged(null)}
 function reset(){const defaults=COLUMNS;if(rows.length<defaults.length){setError("Add enough stages before resetting to the five defaults.");return}setRows(xs=>xs.map((x,i)=>i<defaults.length?{...x,name:defaults[i].label,color:defaults[i].color,is_done:defaults[i].is_done,wip_limit:null}:x));setError("")}
 async function save(){if(!view.workspaceId)return;if(rows.some(x=>!x.name.trim())){setError("Every stage needs a name.");return}if(!rows.some(x=>x.is_done)){setError("Mark one stage as the done stage.");return}setBusy(true);setError("");try{
   const created=new Map<string,string>();
   for(const [i,row] of rows.entries()){const payload={name:row.name.trim(),color:row.color,sort_order:i,wip_limit:row.wip_limit,is_done:row.is_done,automation_enabled:row.automation_enabled};if(row.isNew){const saved=await stageRequest<TaskStage>(view.workspaceId,"", "POST",payload);created.set(row.id,saved.id)}else await stageRequest(view.workspaceId,`${row.id}/`,"PATCH",payload)}
   for(const item of removed){await stageRequest(view.workspaceId,`${item.stage.id}/`,"DELETE",{replacement_stage_id:item.replacement?created.get(item.replacement)??item.replacement:null})}
   await stageRequest(view.workspaceId,"settings/","PATCH",settings);window.location.reload();
  }catch(e){setError(msg(e));setBusy(false)}}
 return <div className="task-modal"><button className="task-modal-backdrop" onClick={close}/><section className="task-create stage-config"><header><div><p className="eyebrow">Task workflow</p><h2>Customize Pipeline Stages</h2><span>Configure columns, limits, and review guardrails.</span></div><button type="button" onClick={close}><X/></button></header><div className="stage-labels"><b>Active pipeline columns</b><span>Drag to change sequence</span></div><div className="stage-rows">{rows.map(row=><div className="stage-row" key={row.id} draggable onDragStart={()=>setDragged(row.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>dropStage(row.id)}><GripVertical/><input aria-label="Stage color" type="color" value={row.color} onChange={e=>update(row.id,{color:e.target.value})}/><input aria-label="Stage name" value={row.name} onChange={e=>update(row.id,{name:e.target.value})}/><span>{row.task_count} tasks</span><label>WIP<input aria-label={`WIP limit for ${row.name}`} type="number" min="1" placeholder="∞" value={row.wip_limit??""} onChange={e=>update(row.id,{wip_limit:e.target.value?Number(e.target.value):null})}/></label><label className="stage-check"><input type="radio" name="done-stage" checked={row.is_done} onChange={()=>setRows(xs=>xs.map(x=>({...x,is_done:x.id===row.id})))}/>Done</label><label className="stage-check"><input type="checkbox" checked={row.automation_enabled} onChange={e=>update(row.id,{automation_enabled:e.target.checked})}/>Auto</label><button aria-label={`Delete ${row.name}`} onClick={()=>remove(row)}><Trash2/></button></div>)}</div><button className="stage-add" onClick={add}><CirclePlus/>Add Stage</button><div className="stage-guardrails"><h3>Stage automation & guardrails</h3><Toggle label="WIP limit warning" detail="Warn before cards exceed the configured limit." checked={settings.wip_warning} set={v=>setSettings(x=>({...x,wip_warning:v}))}/><Toggle label="Auto-notify client when card moved to Client stage" detail="Keep client handoffs visible and consistent." checked={settings.auto_notify_client} set={v=>setSettings(x=>({...x,auto_notify_client:v}))}/><Toggle label="Lock card editing in Approved stage" detail="Protect final work from accidental changes." checked={settings.lock_done_editing} set={v=>setSettings(x=>({...x,lock_done_editing:v}))}/></div>{error&&<p className="form-error">{error}</p>}<footer><button onClick={reset}>Reset to Defaults</button><span/><button onClick={close}>Cancel</button><button onClick={save} disabled={busy}>{busy?"Saving…":"Save Changes"}</button></footer></section></div>
}
function Toggle({label,detail,checked,set}:{label:string;detail:string;checked:boolean;set:(v:boolean)=>void}){return <div className="stage-toggle"><span><strong>{label}</strong><small>{detail}</small></span><Switch label={label} checked={checked} onCheckedChange={set}/></div>}
function Filter({label,value,set,options}:{label:string;value:string;set:(v:string)=>void;options:(readonly[string,string])[]}){return <label className={value?"selected":""}><span>{label}</span><select aria-label={`Filter by ${label.toLowerCase()}`} value={value} onChange={e=>set(e.target.value)}><option value="">All</option>{options.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><ChevronDown/></label>}
async function request<T>(workspaceId:string|null,id:string|null,method:string,payload?:unknown):Promise<T>{if(!workspaceId)throw Error("No workspace selected.");const csrf=decodeURIComponent(document.cookie.split("; ").find(x=>x.startsWith("csrftoken="))?.slice(10)??""),response=await fetch(id?`/api/workspaces/${workspaceId}/tasks/${id}/`:`/api/workspaces/${workspaceId}/tasks/`,{method,credentials:"include",headers:{"Content-Type":"application/json","X-CSRFToken":csrf},...(payload===undefined?{}:{body:JSON.stringify(payload)})});if(!response.ok)throw Error((await response.json().catch(()=>null))?.detail||`Task request failed (${response.status}).`);return response.status===204?undefined as T:response.json()}
async function stageRequest<T>(workspaceId:string,path:string,method:string,payload?:unknown):Promise<T>{const csrf=decodeURIComponent(document.cookie.split("; ").find(x=>x.startsWith("csrftoken="))?.slice(10)??""),response=await fetch(`/api/workspaces/${workspaceId}/task-stages/${path}`,{method,credentials:"include",headers:{"Content-Type":"application/json","X-CSRFToken":csrf},...(payload===undefined?{}:{body:JSON.stringify(payload)})});if(!response.ok)throw Error((await response.json().catch(()=>null))?.detail||`Stage request failed (${response.status}).`);return response.status===204?undefined as T:response.json()}
const normal=(v:string):ColumnId=>v==="IN_PROGRESS"?"REVISIONS":v==="COMPLETED"?"APPROVED":COLUMNS.some(x=>x.id===v)?v as ColumnId:"TODO",title=(v:string)=>v.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,l=>l.toUpperCase()),nameOf=(u:NonNullable<TasksView["members"][number]["user"]>)=>`${u.first_name} ${u.last_name}`.trim()||u.email,initials=(n:string)=>n.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase(),dateLabel=(v:string|null)=>v?new Date(v).toLocaleDateString([],{month:"short",day:"numeric"}):"No date",inputDate=(v?:string|null)=>v?new Date(v).toISOString().slice(0,16):"",overdue=(v:string|null)=>Boolean(v&&new Date(v).getTime()<Date.now()),msg=(e:unknown)=>e instanceof Error?e.message:"Something went wrong.";
function matchesDue(v:string|null,f:DueFilter){if(!f)return true;if(f==="NONE")return!v;if(!v)return false;const now=new Date(),d=new Date(v);if(f==="OVERDUE")return d<now;if(f==="TODAY")return d.toDateString()===now.toDateString();return d>=now&&d.getTime()<=now.getTime()+604800000}

function formatBytes(bytes:number){if(!bytes)return "—";const units=["B","KB","MB","GB","TB"];const i=Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));return `${(bytes/1024**i).toFixed(i===0?0:1)} ${units[i]}`}

function Poster({src,fallback}:{src:string|null;fallback:React.ReactNode}){
 const [broken,setBroken]=useState(false);
 if(!src||broken)return <span className="task-file-glyph">{fallback}</span>;
 return <NextImage src={src} alt="" width={320} height={180} unoptimized onError={()=>setBroken(true)}/>;
}

function runtime(ms:number){const total=Math.max(0,Math.round(ms/1000));const m=Math.floor(total/60),sec=total%60;const h=Math.floor(m/60);return h?`${h}:${String(m%60).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`}
