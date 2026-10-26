"""Generate a small realistic ML paper PDF to exercise the local PDF upload path."""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.units import inch

styles = getSampleStyleSheet()
title_style = ParagraphStyle("T", parent=styles["Title"], fontSize=16)
h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceBefore=10)
body = ParagraphStyle("B", parent=styles["BodyText"], fontSize=10, leading=14)

doc = SimpleDocTemplate("/home/z/my-project/scripts/test-paper.pdf", pagesize=LETTER)
story = [
    Paragraph("PatchMix: Rethinking Patch Mixing for Small-Data Image Classification", title_style),
    Paragraph("J. Doe, A. Researcher, and C. Engineer — Example University, 2025", body),
    Spacer(1, 8),
    Paragraph("Abstract", h2),
    Paragraph(
        "We study patch-mixing augmentation for small-data image classification. "
        "On CIFAR-100 our method reaches 82.6 percent top-1 accuracy, beating the baseline by 1.9 points. "
        "This paper describes the full training setup for reproduction.", body),
    Paragraph("1. Architecture", h2),
    Paragraph(
        "Our model uses a ViT-style encoder with 12 layers and 8 attention heads. "
        "The hidden dimension (d_model) is 384 and the feed-forward dimension d_ff is 1536. "
        "We apply stochastic depth with rate 0.1.", body),
    Paragraph("2. Data and preprocessing", h2),
    Paragraph(
        "We train on CIFAR-100 using the standard train/test split. "
        "Images are resized to 32x32; we use RandAugment with magnitude 9. "
        "No test-time augmentation is used for the main results.", body),
    Paragraph("3. Training setup", h2),
    Paragraph(
        "The learning rate was set to 0.0008 with the AdamW optimizer, weight decay 0.05, "
        "and 10000 warmup steps under a cosine schedule. We train for 200 epochs "
        "with batch size of 512 examples. Dropout of 0.1 is applied to attention outputs. "
        "Random seeds 0, 1, 2 are averaged; we report the mean over 3 runs. "
        "Label smoothing of 0.1 is used with the cross-entropy loss. "
        "All models were trained on 4 NVIDIA A100 GPUs in bf16 precision.", body),
    Paragraph("4. Evaluation protocol", h2),
    Paragraph(
        "We report top-1 accuracy on the CIFAR-100 test split with a single central crop. "
        "The evaluation script version is v2. Checkpoint selection picks the best validation epoch.", body),
    Paragraph("Table 1: Main results", h2),
]
tbl = Table(
    [["Model", "Top-1 Acc (%)", "Params (M)"],
     ["Baseline ViT-S", "80.7", "22"],
     ["PatchMix (ours)", "82.6", "22"]],
    colWidths=[2.4 * inch, 1.6 * inch, 1.2 * inch],
)
tbl.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
story.append(tbl)
doc.build(story)
print("test-paper.pdf written")
