from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Float, Integer, String
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from fpdf import FPDF
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

monitoring_enabled = True

# ---------------- DATABASE ----------------

DATABASE_URL = "sqlite:///sensor_data.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine)

Base = declarative_base()

class SensorTable(Base):

    __tablename__ = "sensor_data"

    id = Column(Integer, primary_key=True, index=True)

    temperature = Column(Float)
    temperature_avg = Column(Float)

    ph = Column(Float)
    ph_avg = Column(Float)

    tds = Column(Float)
    tds_avg = Column(Float)

    turbidity = Column(Float)
    turbidity_avg = Column(Float)

    nh3 = Column(Float)
    nh3_avg = Column(Float)

    wqi = Column(Float)
    quality = Column(String)

    reading_count = Column(Integer)

Base.metadata.create_all(bind=engine)

# ---------------- DATA MODEL ----------------

class SensorData(BaseModel):

    temperature: float
    temperature_avg: float

    ph: float
    ph_avg: float

    tds: float
    tds_avg: float

    turbidity: float
    turbidity_avg: float

    nh3: float
    nh3_avg: float

    wqi: float
    quality: str

    reading_count: int

# ---------------- MONITORING CONTROL ----------------

@app.post("/monitor/start")
def start_monitoring():
    global monitoring_enabled
    monitoring_enabled = True
    return {"status": "monitoring started", "monitoring_enabled": monitoring_enabled}

@app.post("/monitor/stop")
def stop_monitoring():
    global monitoring_enabled
    monitoring_enabled = False
    return {"status": "monitoring stopped", "monitoring_enabled": monitoring_enabled}

@app.get("/monitor/status")
def get_monitor_status():
    global monitoring_enabled
    return {"monitoring_enabled": monitoring_enabled}


# ---------------- RECEIVE DATA FROM ESP32 ----------------

@app.post("/sensor")
async def receive_data(data: SensorData):
    global monitoring_enabled
    if not monitoring_enabled:
        print("Data ignored (monitoring disabled)")
        return {"status": "ignored"}

    db = SessionLocal()

    record = SensorTable(**data.dict())

    db.add(record)

    db.commit()

    db.close()

    print("Received data:")
    print(data)

    return {"status": "stored"}


# ---------------- GET LATEST DATA ----------------

@app.get("/latest")

def get_latest():

    db = SessionLocal()

    result = db.query(SensorTable).order_by(SensorTable.id.desc()).first()

    db.close()

    return result


# ---------------- GET HISTORY ----------------

@app.get("/history")

def get_history():

    db = SessionLocal()

    results = db.query(SensorTable).all()

    db.close()

    return results

# ---------------- GENERATE PDF REPORT ----------------

@app.get("/report")
def generate_pdf_report(location: str = "Unknown Location"):
    db = SessionLocal()
    latest = db.query(SensorTable).order_by(SensorTable.id.desc()).first()
    db.close()

    pdf = FPDF()
    pdf.add_page()
    
    # Title
    pdf.set_font("helvetica", style='B', size=16)
    pdf.cell(0, 10, txt="EcoTide - Water Quality Report", ln=True, align='C')
    pdf.ln(5)

    # Date and Location
    pdf.set_font("helvetica", size=12)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pdf.cell(0, 8, txt=f"Date & Time: {timestamp}", ln=True)
    pdf.cell(0, 8, txt=f"Location: {location}", ln=True)
    pdf.ln(10)

    if not latest:
        pdf.cell(0, 10, txt="No sensor data available in the database.", ln=True)
    else:
        # Table Header
        pdf.set_font("helvetica", style='B', size=12)
        pdf.cell(60, 10, txt="Parameter", border=1, align='C')
        pdf.cell(40, 10, txt="Current Value", border=1, align='C')
        pdf.cell(60, 10, txt="Average", border=1, align='C')
        pdf.ln()

        # Data Rows
        pdf.set_font("helvetica", size=12)
        data_rows = [
            ("Temperature (C)", f"{latest.temperature:.2f}", f"{latest.temperature_avg:.2f}"),
            ("pH Level", f"{latest.ph:.2f}", f"{latest.ph_avg:.2f}"),
            ("TDS (ppm)", f"{latest.tds:.2f}", f"{latest.tds_avg:.2f}"),
            ("Turbidity (NTU)", f"{latest.turbidity:.2f}", f"{latest.turbidity_avg:.2f}"),
            ("Ammonia - NH3 (ppm)", f"{latest.nh3:.2f}", f"{latest.nh3_avg:.2f}"),
            ("Water Quality Index", f"{latest.wqi:.2f}", ""),
            ("Classification", latest.quality, "")
        ]

        for item, val, avg in data_rows:
            pdf.cell(60, 10, txt=item, border=1)
            pdf.cell(40, 10, txt=val, border=1, align='C')
            pdf.cell(60, 10, txt=avg, border=1, align='C')
            pdf.ln()

    # Footer
    pdf.ln(20)
    pdf.set_font("helvetica", style='I', size=10)
    pdf.cell(0, 10, txt="Generated automatically by EcoTide IoT Dashboard", ln=True, align='C')

    report_path = "latest_report.pdf"
    pdf.output(report_path)

    return FileResponse(path=report_path, filename=f"Water_Quality_Report.pdf", media_type='application/pdf')

# ---------------- STATIC ASSETS ----------------
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_dashboard():
    return FileResponse("static/index.html")