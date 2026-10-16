# GMC Check-in: feature list (A se Z), review ke liye

Phase: 0 = bana hua, 1 = pilot, 2 = department, 3 = college, 4 = baad mein. Effort (mera andaza, sirf kaam ka): S ~1 din, M ~2-4 din, L ~1-2 hafte. Flags: **ext** = bahar ka account/paisa/ijazat, **risk** = privacy/legal ihtiyat, **skip** = mera mashwara mat banao.

## Faislay jo aap ko karne hain
1. **Pilot kitna bara?** Sirf BS ECO 5th (1 section) ya pura department? Mera mashwara: pehle 1 section, 2-4 hafte.
2. **Fees ka tareeqa** Pehle manual verification (challan + accounts upload), ya seedha 1Bill/bank integration? Integration ke liye bank/aggregator se baat karni paray gi.
3. **Parents ko access?** Parent portal chahiye ya sirf student? Parent ka data aur consent ka mamla barhta hai.
4. **Android app?** Play Store par app chahiye ya PWA (browser se install) kaafi hai? Organisation account ho to Play Store aasan hai.
5. **Marks / results kab?** Mera mashwara: attendance aur announcements 1 semester chal jayein, phir marks.

## Attendance (hamari bunyad)
Ye module sab se pehle pakka hona chahiye. Baqi sab is par khara hai.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| ATT-01 | Roster marking P/A/L/T + offline queue | Teacher class ki hazri lagata hai, internet na ho to baad mein khud sync. | Bana hua | - |  |
| ATT-02 | 6-digit rotating code check-in | Student code likh kar khud hazri lagata hai, har 30 second mein code badalta hai. | Bana hua | - |  |
| ATT-03 | Location (geofence) check | Code sirf classroom ke andar chalta hai (teacher on kare to). | Bana hua | - |  |
| ATT-04 | Rotating QR code (code ke saath) | Teacher ki screen par QR, student phone se scan kare. Code se tez, lekin camera permission chahiye. | Phase 2 · Department | S |  |
| ATT-05 | Ek student = ek device (proxy rokna) | Pehle login wala device bind hota hai; doosre phone se check-in par teacher ko flag. Perfect nahi, sirf rukawat. | Phase 2 · Department | M | risk |
| ATT-06 | Leave application + approval | Student leave ke liye apply karta hai, HOD approve/reject karta hai, approve par us muddat ki absent hazri leave ban jati hai. Bana hua. | Bana hua | - |  |
| ATT-07 | Medical certificate upload | Leave ke saath document attach. Sehat ka data hai, is liye sakht access aur retention rule. | Phase 2 · Department | M | risk |
| ATT-08 | Hazri correction request | Student 7 din ke andar "main hazir tha" likhta hai, course teacher manzoor/rad karta hai, stats khud theek. Bana hua. | Bana hua | - |  |
| ATT-09 | Condonation / shortage relief | College rule ke mutabiq HOD kam hazri mein riayat de sake, wajah ke saath. | Phase 3 · College | M |  |
| ATT-10 | Auto-warning ladder (80% / 75% / 70%) | Roz khud chalta hai: minimum ke 5 point qareeb par ek notice, minimum se neeche jane par doosra. Dobara nahi bhejta. Bana hua. | Bana hua | - |  |
| ATT-11 | Holiday calendar + class-cancel | Calendar (chuttiyan, imtehan, deadline) admin ke zariye; holiday par lecture banane se pehle poochta hai. Cancelled-lecture ka alag nishan abhi nahi. Bana hua. | Bana hua | - |  |
| ATT-12 | Substitute / extra / make-up lecture | Doosra teacher cover kare ya extra class ho to record sahi rahe. | Phase 2 · Department | M |  |
| ATT-13 | Teacher attendance & punctuality | Teacher ke lecture start/end ka record (HOD ke liye). | Phase 3 · College | M | risk |
| ATT-14 | Guardian alert (parent ko) | Lagatar absent par parent ko message. Parent portal ya SMS/WhatsApp se. | Phase 3 · College | M | ext |
| ATT-15 | RFID/NFC card ya biometric device import | Hardware se aayi hazri import. Alag device aur driver kaam hai. | Baad mein | L | ext |
| ATT-16 | Selfie/face-recognition attendance | Chehra pehchan kar hazri. | Baad mein | L | skip |

## Academics (nizam-e-taleem)
Pakistan mein 75% hazri aam shart hai (Punjab University, Hamdard mein tasdeeq hui). HEC ka sahi lafz aur apni university ka rule alag ho sakta hai, pehle apna prospectus dekhna hoga.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| ACA-01 | Departments / programs / terms / sections / courses / offerings | Poora structure. Bana hua hai. | Bana hua | - |  |
| ACA-02 | Term rollover (semester aage barhana) | Naye semester mein sections banti hain (semester +1), students move hote hain, purana record mehfooz. Aakhri semester ke baad students "left". Bana hua. | Bana hua | - |  |
| ACA-03 | Timetable builder + clash checker | Haftawar timetable (student/teacher/HOD/admin) aur clash checker (teacher, room, section). Offerings mein din, waqt, dauraniya. Bana hua. | Bana hua | - |  |
| ACA-04 | Room allocation & capacity | Kamray, capacity, lab. | Phase 3 · College | M |  |
| ACA-05 | Student course registration | Student apne courses khud chune, prerequisite check, credit-hour limit. | Phase 3 · College | L |  |
| ACA-06 | Course outline / syllabus upload | Har course ka outline aur lecture plan. | Phase 2 · Department | S |  |
| ACA-07 | Faculty workload report | Kis teacher ke kitne credit hours / lectures. | Phase 3 · College | S |  |
| ACA-08 | Academic calendar (ICS feed) | App ke andar academic calendar sab ko dikhta hai. Phone calendar mein (ICS) abhi nahi. Bana hua. | Bana hua | - |  |

## Exams, marks, results
Ye sab se hassas hissa hai. Pehle attendance aur announcements pakke karein, phir marks. Galti ka nuqsan sab se bara hai.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| EXM-01 | Exam eligibility (hazri se khud) | Marks sheet aur published result par hazri ki shart (eligible) ka nishan. Bana hua. | Bana hua | - |  |
| EXM-02 | Assessment components & weights | Har course ke components aur unka wazan (15/25/60 ka preset, apni marzi ka bhi). Bana hua. | Bana hua | - |  |
| EXM-03 | Marks entry (teacher) + HOD approval | Teacher marks bhare, HOD manzoor ya wapas kare, publish ke baad lock, sirf admin reason ke saath reopen. Bana hua. | Bana hua | - |  |
| EXM-04 | Grade scale, GPA / CGPA | Grade table admin khud set kare (University of Gujrat ka official table daalna zaroori), credit-weighted GPA/CGPA. Bana hua. | Bana hua | - |  |
| EXM-05 | Result card / DMC (PDF) | Student ka result page (print / PDF), CGPA aur GPA. QR verify abhi nahi. | Bana hua | - |  |
| EXM-06 | Transcript | Admin/HOD kisi bhi student ka transcript dekh aur print kar sakta hai. Official stamp ka workflow abhi nahi. Bana hua. | Bana hua | - |  |
| EXM-07 | Datesheet & seating plan | Paper ki tareekhein, kamra, roll number slips. | Baad mein | L |  |
| EXM-08 | Recheck / recount request | Student recheck ki darkhwast de, fee ke saath. | Baad mein | M |  |
| EXM-09 | Invigilation duty roster | Kis teacher ki kahan duty. | Baad mein | M |  |

## Fees & finance
Pakistan mein aam tareeqa: challan banta hai aur 1Bill/KuickPay ya bank app/JazzCash se ada hota hai, lekin har university ke rules aur channels alag hain (research mein tazad mila). Bank ya aggregator ka agreement chahiye, is liye pehle "manual verification" version.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| FEE-01 | Fee structure (program / semester ke hisab se) | Fee plan (tuition, library, ... ki muddein), semester ke hisab se. Bana hua. | Bana hua | - |  |
| FEE-02 | Challan generation (PDF) | Numbered voucher (digits + check digit), poore section ke liye ek click mein, print. Bana hua. | Bana hua | - |  |
| FEE-03 | Payment verification (manual upload / bank file) | Accounts staff cash/bank payment likhe ya bank statement CSV import kare (voucher number se match, dobara upload mehfooz). Bana hua. | Bana hua | - |  |
| FEE-04 | 1Bill / KuickPay / Raast online integration | Khud ba khud payment confirm. Bank ya aggregator se agreement aur technical docs chahiye, jo maine abhi nahi dekhe. | Baad mein | L | ext |
| FEE-05 | Installments, late fine, scholarship, refund | Qiston (partial payment), discount/scholarship, late fine (rozana + hadd), payment reverse reason ke saath. Refund alag nahi. Bana hua. | Bana hua | - |  |
| FEE-06 | Defaulters list & reminders | Overdue filter, baqaya raqam, CSV export. Reminder notification abhi nahi. Bana hua. | Bana hua | - |  |
| FEE-07 | Full accounting / payroll | Poora hisaab kitab aur tankhwah. | Baad mein | L | skip |

## Admissions
Naye students ke liye. Abhi chhote pilot ko iski zaroorat nahi.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| ADM-01 | Online application form + documents | Applicant form bhare, documents upload. | Baad mein | L | risk |
| ADM-02 | Merit list & offer letter | Criteria set karke merit, offer PDF. | Baad mein | M |  |
| ADM-03 | Entry test scheduling | Test ki tareekh, roll number slip. | Baad mein | M |  |
| ADM-04 | Admission to student record | Manzoor shuda applicant seedha student ban jaye, roll number bane. | Baad mein | S |  |

## Student services

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| STU-01 | Student profile & documents | Student apna phone, email, guardian ka naam/phone, pata khud likhta hai. Bana hua. | Bana hua | - |  |
| STU-02 | ID card with QR (PDF print) | Digital aur print card, QR se verify. | Phase 3 · College | M |  |
| STU-03 | Certificates (bonafide / character) with QR verification | Bonafide, character, fee clearance (balance zero ho to), attendance certificate. Print, aur public page par code se tasdeeq. QR image abhi nahi. Bana hua. | Bana hua | - |  |
| STU-04 | Complaints / grievance box | Student category ke saath likhta hai; HOD ya admin jawab deta hai; "mera naam chhupao" ka option; harassment sirf admin ko. Bana hua. | Bana hua | - |  |
| STU-05 | Teacher feedback survey (QEC style) | Anonymous rating (6 sawal), har course par ek baar, teacher ko sirf average aur sirf 5+ jawab ke baad. Bana hua. | Bana hua | - |  |
| STU-06 | Disciplinary record | Sirf admin/HOD ko, sakht access. | Baad mein | M | risk |
| STU-07 | Alumni directory | Pass-out students ka record. | Baad mein | M |  |
| STU-08 | Clubs & events | Society, event registration. | Baad mein | M |  |

## Communication
Push notification muft hai. WhatsApp API ka kharcha lagta hai (pichli research: Pakistan mein taqreeban $0.01-0.015 per message). Ghair-sarkari WhatsApp tools se account ban ho sakta hai, is liye mat use karein.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| COM-01 | Announcements + push + inbox | Bana hua hai. | Bana hua | - |  |
| COM-02 | Notice board (department / section) | Ghair-zaroori sab ko push na ho, sirf inbox. | Phase 2 · Department | S |  |
| COM-03 | Teacher-student messaging | Class ke andar sawal jawab. Moderation aur abuse ka khayal. | Phase 3 · College | L | risk |
| COM-04 | Email notifications | Password reset aur ahem notice email se. Mail server ya service chahiye. | Phase 3 · College | M | ext |
| COM-05 | SMS gateway | Jin ke paas push nahi. Kharcha aur provider ka intikhab baqi. | Baad mein | M | ext |
| COM-06 | WhatsApp Business API | Official API se parent/student ko message. Paisa per message. | Baad mein | M | ext |
| COM-07 | Emergency broadcast | Ek button se sab ko ahem ittela. | Phase 3 · College | S |  |
| COM-08 | Parent portal (read-only) | Walid sirf apne bachay ki hazri dekhe. Consent aur verify karna zaroori. | Phase 3 · College | L | risk |

## Learning (LMS-lite)
Mera mashwara: poora LMS khud mat banao. Google Classroom ya Moodle jese se link karna sasta aur behtar.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| LMS-01 | Course material upload (files / links) | Teacher slides/notes lagaye. | Phase 3 · College | M |  |
| LMS-02 | Assignment submission | Student file jama kare, teacher marks de. | Baad mein | L |  |
| LMS-03 | MCQ quiz | Online quiz. Cheating aur load ka masla. | Baad mein | L |  |
| LMS-04 | Google Classroom / Moodle link | Hamare students/courses ko un se joRna. | Baad mein | M | ext |
| LMS-05 | Poora apna LMS | Discussion, grading, plagiarism sab kuch. | Baad mein | L | skip |

## Library, hostel, transport
Sirf agar college ko waqai chahiye. Har ek alag chhota system hai.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| LIB-01 | Library catalogue + issue/return + fine | Kitab, member, due date. | Baad mein | L |  |
| LIB-02 | Hostel allocation | Kamre, fees se link. | Baad mein | L |  |
| LIB-03 | Transport routes & fees | Bus routes, students. | Baad mein | L |  |

## Faculty / HR

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| HR-01 | Faculty profiles & qualifications | Teacher ki maloomat (HEC/QEC reports ke kaam ki). | Phase 3 · College | S |  |
| HR-02 | Staff leave management | Teacher ki chhuti manzoori. | Phase 3 · College | M |  |
| HR-03 | Performance evaluation (PER) | Saalana jaiza. | Baad mein | L | risk |

## Analytics & reports

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| ANA-01 | HOD dashboard + shortage list + CSV | Bana hua hai. | Bana hua | - |  |
| ANA-02 | Early-warning (hazri + marks se khatray mein students) | HOD ke page par: kam hazri, minimum ke qareeb, fail courses ke hisab se khatre mein students. Bana hua. | Bana hua | - |  |
| ANA-03 | Teacher/course comparison, heatmaps | Kaun si class mein hazri kam. | Phase 3 · College | M |  |
| ANA-04 | Scheduled email report (haftawar PDF) | HOD ko har Monday report. | Phase 3 · College | S | ext |
| ANA-05 | HEC/QEC style export | University ke reporting format mein Excel. | Baad mein | M |  |

## Security & privacy
Pakistan mein abhi koi mukammal data-protection qanoon nafiz nahi (research ke mutabiq 2025 ka draft aur 2023 wale bill ki mukhtalif khabrein hain, sarkari gazette se tasdeeq karein). Phir bhi college ki likhit ijazat aur "kam se kam data" usool lazmi hain.

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| SEC-01 | RBAC, audit log, lockout, CSRF, CSP | Bana hua hai. | Bana hua | - |  |
| SEC-02 | 2FA (authenticator app) for admin / HOD | Authenticator app (TOTP) aur 8 backup codes, replay band. Bana hua. | Bana hua | - |  |
| SEC-03 | "Sign out everywhere" + active sessions list | Apne devices ki list aur "baqi sab se sign out". Bana hua. | Bana hua | - |  |
| SEC-04 | Privacy policy page + consent record | Student ko batana ke kya data, kyun, kab tak. | Phase 2 · Department | M | risk |
| SEC-05 | Data export / delete request tool | Admin ek student ka poora data JSON mein export kar sakta hai, ya zaati tafseel hata sakta hai (results/hazri/fees ka record rehta hai). Bana hua. | Bana hua | - |  |
| SEC-06 | Retention rules (purana data khud mitana) | Maslan leave documents 1 saal baad. | Phase 3 · College | M | risk |
| SEC-07 | Two-person approval for sensitive changes | Marks lock khulna jese kaam mein 2 log. | Baad mein | M |  |
| SEC-08 | Independent security test (pen-test) | Bahar ka mahir hamla karke dekhe. Paisa lagta hai. | Baad mein | L | ext |

## Platform & operations

| ID | Feature | Kya hai | Phase | Effort | Flag |
|---|---|---|---|---|---|
| PLT-01 | Install script, backup, auto-rollback updater | Bana hua hai (VPS par abhi test nahi hua). | Bana hua | - |  |
| PLT-02 | Uptime monitor + alert | Server band ho to aap ko email/push. | Phase 1 · Pilot | S | ext |
| PLT-03 | Staging copy (test server) | Naya feature pehle test par, phir asli par. | Phase 2 · Department | M |  |
| PLT-04 | Off-site backup (rclone) + monthly restore drill | Backup doosri jagah, aur waqai bahal ho kar dekhna. | Phase 1 · Pilot | S | ext |
| PLT-05 | Admin UI: backups list, restore, health | Terminal ke bajaye screen se. | Phase 2 · Department | M |  |
| PLT-06 | Android app (Trusted Web Activity) | Play Store par app. Organisation account se 12-tester wali shart nahi lagti (pichli research), warna personal account par 14 din. | Phase 3 · College | M | ext |
| PLT-07 | Multi-campus support | Ek hi system mein kayi campus. | Baad mein | L |  |
| PLT-08 | Custom roles / permissions builder | Admin khud naye role bane. | Baad mein | L |  |
| PLT-09 | Single sign-on (Google / Microsoft) | College email se login. | Baad mein | M | ext |
| PLT-10 | Public API + webhooks | Doosre systems se judna. | Baad mein | L |  |
| PLT-11 | Domain + email sender (SPF/DKIM) | Asli domain, email deliver hone ke liye. | Phase 1 · Pilot | S | ext |

## Research ke nuqte (sources)
- Punjab University semester rules: 75% hazri lazmi, quiz/mid/final ka 15/25/60 wazan (sirf ek university ki misal): https://mao.punjab.gov.pk/index.php/semester-rules-and-regulations
- Hamdard: 75% hazri, CGPA 2.5: https://www.hamdard.edu.pk/academic-rules-fssh/
- HEC semester examination guidelines (draft copy, sahi lafz hec.gov.pk se dekhein): https://bnu.edu.pk/portals/HEC-Draft-Policy-Guidelines-for-Semester-Examination-System-(Final).pdf
- Fee challan aur 1Bill/KuickPay ka tareeqa (QAU, LCWU): https://ugadmissions.qau.edu.pk/feeweb/Instructions.html
- Aam ERP modules ki fehrist (vendor pages, azaad maiyar nahi): https://openeducat.org/features/education-erp/
- Pakistan data-protection ki surat-e-haal (gazette se tasdeeq karein): https://www.dlapiperdataprotection.com/?c=PK
