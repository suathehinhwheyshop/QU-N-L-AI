export const STEPS = [
  {id:'export', name:'Lấy dữ liệu GSC', owner:'Grokbot', short:'Dữ liệu', description:'Xuất dữ liệu đúng website, khoảng ngày và bộ lọc.'},
  {id:'analyze', name:'Phân tích chuyên sâu', owner:'Claude', short:'Phân tích', description:'Đọc nguồn, so sánh và xác định cơ hội SEO.'},
  {id:'plan', name:'Lập bảng công việc', owner:'Orbit', short:'Kế hoạch', description:'Chuyển đề xuất thành từng việc có tiêu chí hoàn thành.'},
  {id:'execute', name:'Thực hiện tối ưu', owner:'Grokbot', short:'Thực hiện', description:'Chỉ xử lý các việc nằm trong phạm vi đã cho phép.'},
  {id:'verify', name:'Kiểm tra thay đổi', owner:'Orbit + Grokbot', short:'Kiểm tra', description:'Đối chiếu trước/sau và bằng chứng của từng thay đổi.'},
  {id:'report', name:'Tổng hợp báo cáo', owner:'Orbit', short:'Báo cáo', description:'Tổng hợp việc đã làm, việc bị chặn và lịch đo lường tiếp.'},
];
export const SCOPE_NAMES = {metadata:'Title & meta description', links:'Internal link', content:'Nội dung trang', technical:'Cấu hình kỹ thuật'};
const clone = value => JSON.parse(JSON.stringify(value));
function log(run,message,kind='info') { run.log.push({at:new Date().toISOString(),message,kind}); }
function artifact(run,id,title,payload) {
  if (!run.artifacts.some(a=>a.id===id)) run.artifacts.push({id,title,payload,mode:'simulation'});
}
export function validateConfig(config) {
  let url;
  try { url=new URL(config.site); } catch { throw new Error('Nhập website đầy đủ, ví dụ https://wheyshop.vn.'); }
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('Dùng địa chỉ gốc HTTPS của website, không kèm tài khoản, đường dẫn hay tham số.');
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  if (!isDate(config.start) || !isDate(config.end) || config.start>config.end) throw new Error('Khoảng ngày lấy dữ liệu chưa hợp lệ.');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(config.end>today) throw new Error('Ngày kết thúc dữ liệu không được nằm trong tương lai.');
  if (!config.goal?.trim()) throw new Error('Anh nhập mục tiêu cần thực hiện.');
  if (!Array.isArray(config.scope) || !config.scope.length || config.scope.some(s=>!Object.hasOwn(SCOPE_NAMES,s))) throw new Error('Chọn ít nhất một nhóm thay đổi được phép thực hiện.');
  return {...config, site:url.origin, goal:config.goal.trim(), scope:[...new Set(config.scope)], model:config.model?.trim() || 'Chưa chọn model', profile:config.profile?.trim() || 'SEO chuyên sâu · chưa kết nối'};
}
export function createRun(config) {
  config=validateConfig(config);
  const run={id:globalThis.crypto.randomUUID(),mode:'simulation',createdAt:new Date().toISOString(),config:clone(config),status:'ready',steps:STEPS.map(s=>({id:s.id,status:'pending',attempts:0})),tasks:[],artifacts:[],log:[]};
  log(run,'Đã tạo yêu cầu mô phỏng. Chưa gửi lệnh tới AI hoặc website.');
  return run;
}
export function startRun(run) {
  if(!['ready','paused'].includes(run.status)) return false;
  run.status='running'; log(run,'Bắt đầu mô phỏng quy trình.'); return true;
}
export function pauseRun(run,reason='Anh đã tạm dừng mô phỏng.') {
  if(run.status!=='running')return false;
  run.status='paused';log(run,reason);return true;
}
export function retryRun(run) {
  if(run.status!=='error')return false;
  const failed=run.steps.find(s=>s.status==='error');
  if(!failed)return false;
  failed.status='pending';run.status='running';log(run,'Chạy lại đúng bước lỗi, giữ nguyên mã công việc và các đầu ra đã có.');return true;
}
function comparison(config) {
  const duration = Date.parse(config.end)-Date.parse(config.start)+86400000;
  return {start:new Date(Date.parse(config.start)-duration).toISOString().slice(0,10),end:new Date(Date.parse(config.start)-86400000).toISOString().slice(0,10)};
}
function makeTasks(run) {
  const site=run.config.site;
  const items=[
    {key:'01',title:'Điều chỉnh title trang Whey Isolate',type:'metadata',path:'/whey-isolate',reason:'Ví dụ minh họa: trang có nhiều hiển thị nhưng CTR thấp.',criteria:'Title đúng bản đã duyệt, URL giữ nguyên; kiểm tra hiển thị trên trang.',before:'Whey Isolate | WheyShop',after:'Whey Isolate: lựa chọn theo nhu cầu | WheyShop'},
    {key:'02',title:'Bổ sung internal link theo ngữ cảnh',type:'links',path:'/whey-protein',reason:'Ví dụ minh họa: bổ sung đường dẫn liên quan giữa hai danh mục.',criteria:'Liên kết tồn tại, trỏ đúng trang cùng website; nguồn và đích trả HTTP 200.',before:'Chưa có liên kết tại đoạn chọn mua.',after:`Thêm liên kết theo ngữ cảnh đến ${site}/whey-isolate.`},
    {key:'03',title:'Làm rõ meta description trang Creatine',type:'metadata',path:'/creatine',reason:'Ví dụ minh họa: mô tả trang chưa thể hiện rõ mục đích chọn mua.',criteria:'Meta description đúng đề xuất, không thêm cam kết công dụng.',before:'Sản phẩm Creatine tại WheyShop.',after:'Tham khảo Creatine theo nhu cầu tập luyện, quy cách và ngân sách tại WheyShop.'},
    {key:'04',title:'Bổ sung nội dung giải đáp trên danh mục',type:'content',path:'/whey-isolate',reason:'Ví dụ minh họa: cần dữ liệu sản phẩm và nguồn xác minh trước khi viết.',criteria:'Có nguồn cho thông tin sản phẩm; nội dung được kiểm tra trước khi xuất bản.',before:'Chưa có phần giải đáp theo đề xuất.',after:'Đề xuất bổ sung nội dung sau khi xác minh dữ liệu sản phẩm.'},
  ];
  return items.map(item=>({...item,id:`SEO-${item.key}`,url:site+item.path,status:run.config.scope.includes(item.type)?'todo':'blocked',note:'',evidence:null,mode:'simulation'}));
}
export function advanceRun(run) {
  if(run.status!=='running')return null;
  const step=run.steps.find(s=>s.status==='pending');
  if(!step)return null;
  step.attempts++;
  if(step.id==='export'&&run.config.scenario==='export-error'&&step.attempts===1){
    step.status='error';run.status='error';log(run,'Lỗi giả lập: Grokbot chưa trả file GSC. Các bước sau chưa được chạy.','error');return step.id;
  }
  const c=run.config;
  if(step.id==='export'){
    const compare=comparison(c);
    artifact(run,'gsc','Dữ liệu GSC mẫu',{demo:true,notice:'Dữ liệu cố định để thử luồng; không lấy từ GSC và không phản ánh website.',site:c.site,period:{start:c.start,end:c.end},comparison:compare,filters:{searchType:'web',country:'all',device:'all'},metrics:{clicks:12840,impressions:486200,ctr:0.0264,position:9.8},previous:{clicks:14260,impressions:472000,ctr:0.0302,position:9.1},rows:[{page:c.site+'/whey-isolate',query:'whey isolate',clicks:320,impressions:18200,position:8.2},{page:c.site+'/creatine',query:'creatine',clicks:410,impressions:16900,position:7.4}],source:'Grokbot · dữ liệu mô phỏng'});
  }
  if(step.id==='analyze')artifact(run,'analysis','Phân tích SEO mẫu',{demo:true,source:'gsc',model:c.model,profile:c.profile,summary:'Mẫu minh họa: lượt nhấp giảm trong khi lượt hiển thị tăng. Cần đối chiếu truy vấn, trang và thứ hạng trước khi kết luận nguyên nhân.',observations:['Xem xét CTR theo từng trang và truy vấn, tránh kết luận từ CTR tổng.','GSC không đủ để xác nhận lỗi nội dung hoặc kỹ thuật; cần kiểm tra website trước khi sửa.'],recommendedGroups:['metadata','links','content'],confidence:'Chỉ là ví dụ; không phải phân tích thật của Claude.'});
  if(step.id==='plan'){
    if(!run.tasks.length)run.tasks=makeTasks(run);
    artifact(run,'plan','Kế hoạch công việc mẫu',{demo:true,source:'analysis',allowedScope:c.scope,tasks:run.tasks.map(t=>({id:t.id,title:t.title,type:t.type,url:t.url,reason:t.reason,criteria:t.criteria}))});
  }
  if(step.id==='execute'){
    for(const task of run.tasks){
      if(!c.scope.includes(task.type)){task.status='blocked';continue;}
      task.status='executed';task.evidence={demo:true,before:task.before,after:task.after,notice:'Không có thay đổi nào được gửi lên website.'};
    }
    artifact(run,'changes','Đối chiếu thay đổi mẫu',{demo:true,changes:run.tasks.filter(t=>t.status==='executed').map(t=>({id:t.id,url:t.url,...t.evidence})),blocked:run.tasks.filter(t=>t.status==='blocked').map(t=>t.id)});
  }
  if(step.id==='verify'){
    for(const t of run.tasks)if(t.status==='executed')t.status='verified';
    artifact(run,'checks','Biên bản kiểm tra mẫu',{demo:true,checks:run.tasks.filter(t=>t.status==='verified').map(t=>({id:t.id,criteria:t.criteria,result:'Đạt trong mô phỏng; chưa kiểm tra website thật.'})),seoImpact:'Chưa đo lường. Không suy ra tăng trưởng SEO từ việc hoàn thành thay đổi.'});
  }
  step.status='done';
  log(run,`${STEPS.find(s=>s.id===step.id).name}: hoàn tất mô phỏng.`);
  if(step.id==='report'){
    const blocked=run.tasks.filter(t=>t.status==='blocked').length;
    run.status=blocked?'needs_action':'complete';run.finishedAt=new Date().toISOString();
    artifact(run,'report','Báo cáo kết thúc mẫu',{demo:true,verified:run.tasks.filter(t=>t.status==='verified').length,blocked,conclusion:blocked?'Đã kết thúc mô phỏng; còn việc ngoài phạm vi cần anh quyết định.':'Hoàn tất mô phỏng các việc trong phạm vi.',websiteChanged:false,followUp:'Ở bản kết nối thật: lưu ngày áp dụng và đặt lịch so sánh dữ liệu GSC sau thay đổi. Chưa có lịch chạy nền trong bản mẫu.'});
    log(run,blocked?`Còn ${blocked} việc bị chặn do ngoài phạm vi. Không tự mở rộng quyền sửa.`:'Đã kết thúc mô phỏng. Website chưa bị thay đổi.',blocked?'warning':'info');
  }
  return step.id;
}
export function recoverRun(run) {
  if(run.status==='running')pauseRun(run,'Phiên trình duyệt trước đã đóng hoặc tải lại. Nhấn tiếp tục để chạy phần còn lại.');
  return run;
}
export function updateNote(run,taskId,note) {
  const task=run.tasks.find(t=>t.id===taskId);
  if(!task)return false;
  task.note=String(note).slice(0,3000);return true;
}
export function toCsv(run) {
  const safe=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const headers=['Mã việc','Công việc','URL','Nhóm','Trạng thái mô phỏng','Tiêu chí hoàn thành','Ghi chú','Chế độ'];
  const rows=run.tasks.map(t=>[t.id,t.title,t.url,SCOPE_NAMES[t.type],t.status,t.criteria,t.note,'DEMO - chưa sửa website']);
  return '\ufeff'+[headers,...rows].map(row=>row.map(safe).join(',')).join('\r\n');
}
