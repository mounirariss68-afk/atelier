"""Make a watermarked test copy; never modify the source document."""
import glob
from pathlib import Path
import fitz

source = glob.glob("/tmp/antur-test/*.pdf")[0]
doc = fitz.open(source)
page = doc.new_page(width=612, height=792)
page.insert_text((42, 92), "Sequential DocuSeal signing test", fontsize=21)
page.insert_text((42, 125), "Reference: CGNR-NDA-9-26-1 | Cognirise / Antur NDA", fontsize=11)
page.insert_textbox(fitz.Rect(42, 150, 570, 220),
    "This additional page is solely for testing electronic signatures. "
    "It does not execute or amend the attached NDA. Existing document content "
    "has been preserved. Neither signer acts as an authorized company representative "
    "through this test.", fontsize=11)
page.insert_text((42, 265), "SECOND SIGNER", fontsize=11)
page.insert_textbox(fitz.Rect(42, 280, 295, 340),
    "COGNITIVE RISE ARTIFICIAL\nINTELLIGENCE DEVELOPING\nSERVICES L.L.C", fontsize=11)
page.insert_text((330, 265), "FIRST SIGNER", fontsize=11)
page.insert_textbox(fitz.Rect(330, 280, 580, 340),
    "ANTUR TURIZM ANONIM SIRKETI\n(Antur Turizm A.S.)", fontsize=11)
page.insert_text((42, 355), "Gokhan Guney - test signer", fontsize=11)
page.insert_text((330, 355), "Mounir Ariss - test signer", fontsize=11)
for x in (42, 330):
    page.draw_rect(fitz.Rect(x, 380, x+230, 450), color=(.5,.5,.5))
    page.insert_text((x, 470), "DocuSeal test signature", fontsize=10)
page.insert_textbox(fitz.Rect(42, 530, 565, 610),
    "Signing order: Mounir first under Antur; Gokhan second under Cognitive Rise. "
    "Gokhan receives his invitation only after Mounir completes signing.", fontsize=12)
for p in doc:
    p.draw_rect(fitz.Rect(0,0,p.rect.width,30),fill=(1,.92,.92),color=None)
    p.insert_text((180,20),
        "TEST — NOT FOR EXECUTION",fontname="hebo",fontsize=14,color=(.75,0,0))
    p.insert_text((110, 420), "TEST - NOT FOR EXECUTION",fontsize=25,color=(.75,0,0),fill_opacity=.16)
out=Path("generated/antur-signing-test")
out.mkdir(parents=True,exist_ok=True)
doc.save(out/"Antur-NDA-TEST-NOT-FOR-EXECUTION.pdf")
doc[-1].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(out/"signature-page.png")
doc[0].get_pixmap().save(out/"first-page.png")
print(f"Prepared {len(doc)} pages.")