"use client";
import React, { useState } from 'react';
import './Booking.css';
import pricing from '../../data/pricing.json';

const Booking = ({ service, onClose }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [location, setLocation] = useState('Tampa');
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState('');

  const [appointmentDetails, setAppointmentDetails] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentTransactionId, setPaymentTransactionId] = useState('');

  const [isSavingToCalendly, setIsSavingToCalendly] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingResult, setBookingResult] = useState(null);

  const envAmount = process.env.NEXT_PUBLIC_BOOKING_PRICE ? parseFloat(process.env.NEXT_PUBLIC_BOOKING_PRICE) : undefined;
  const mappedPrice = pricing?.[service.code] ?? undefined;
  const priceAmount = Number.isFinite(envAmount) ? envAmount : (Number.isFinite(mappedPrice) ? mappedPrice : 65.0);
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

  const canContinueDetails = appointmentDetails.firstName && appointmentDetails.lastName && appointmentDetails.email && appointmentDetails.phone;

  const generateCalendarDays = () => {
    const days = [];
    const today = new Date();

    for (let i = 0; i < 30; i += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dow = date.getDay();

      let openDay = false;
      if (location === 'Tampa') {
        openDay = dow >= 1 && dow <= 5;
      } else if (location === 'Tarpon Springs') {
        openDay = dow === 0 || dow === 6;
      }

      if (openDay) {
        days.push({
          date,
          day: date.getDate(),
          month: date.toLocaleDateString('en-US', { month: 'short' }),
          dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
          isToday: i === 0,
        });
      }
    }

    return days;
  };

  const fetchAvailableTimes = async (date) => {
    setIsLoadingSlots(true);
    setSlotError('');
    setAvailableSlots([]);

    try {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const res = await fetch('/api/calendly/available-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startISO: dayStart.toISOString(),
          endISO: dayEnd.toISOString(),
          timezone: userTimezone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to load available times');
      }

      const slots = Array.isArray(data?.slots) ? data.slots : [];
      setAvailableSlots(slots);
      if (!slots.length) {
        setSlotError('No available times for this day. Please choose another date.');
      }
    } catch (err) {
      setSlotError(String(err?.message || err));
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleDateSelect = async (date) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    await fetchAvailableTimes(date);
    setCurrentStep(2);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setAppointmentDetails((prev) => ({ ...prev, [name]: value }));
  };

  const checkHelcimPayReady = () => {
    if (typeof window !== 'undefined' && typeof window.appendHelcimPayIframe === 'function') {
      return Promise.resolve(true);
    }
    return Promise.reject(new Error('HelcimPay script not loaded. Please refresh the page.'));
  };

  const createCalendlyBooking = async (transactionId) => {
    if (!selectedSlot?.startTime) throw new Error('Please select a valid time slot.');

    setBookingError('');
    setIsSavingToCalendly(true);

    try {
      const res = await fetch('/api/calendly/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: selectedSlot.startTime,
          timezone: userTimezone,
          location,
          service: {
            code: service.code,
            title: service.title,
          },
          paymentTransactionId: transactionId || paymentTransactionId || '',
          invitee: {
            firstName: appointmentDetails.firstName,
            lastName: appointmentDetails.lastName,
            email: appointmentDetails.email,
            phone: appointmentDetails.phone,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Unable to save booking in Calendly.');
      }

      setBookingResult(data);
      setCurrentStep(5);
    } catch (err) {
      setBookingError(String(err?.message || err));
    } finally {
      setIsSavingToCalendly(false);
    }
  };

  const openHelcimPay = async () => {
    if (isProcessingPayment || paymentComplete) return;

    setPaymentError('');
    setBookingError('');
    setIsProcessingPayment(true);

    try {
      const initRes = await fetch('/api/helcim/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentType: 'purchase',
          amount: priceAmount,
          currency: 'USD',
          confirmationScreen: true,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok || !initData?.checkoutToken) {
        throw new Error(initData?.error || 'Unable to start checkout');
      }

      await checkHelcimPayReady();

      await new Promise((resolve, reject) => {
        const eventName = `helcim-pay-js-${initData.checkoutToken}`;
        const timeoutId = setTimeout(() => {
          window.removeEventListener('message', handlePaymentMessage);
          reject(new Error('Payment session timed out. Please try again.'));
        }, 5 * 60 * 1000);

        async function handlePaymentMessage(event) {
          if (event?.data?.eventName !== eventName) return;

          const status = event?.data?.eventStatus;
          const rawMessage = event?.data?.eventMessage;

          if (status === 'SUCCESS') {
            let transactionId = '';
            try {
              const parsed = rawMessage ? JSON.parse(rawMessage) : null;
              transactionId = String(parsed?.data?.transactionId || '');
            } catch {
              transactionId = '';
            }

            setPaymentTransactionId(transactionId);
            setPaymentComplete(true);

            clearTimeout(timeoutId);
            window.removeEventListener('message', handlePaymentMessage);
            resolve(true);

            await createCalendlyBooking(transactionId);
            return;
          }

          if (status === 'ABORTED') {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handlePaymentMessage);
            reject(new Error('Payment was declined or cancelled.'));
            return;
          }

          if (status === 'ERROR') {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handlePaymentMessage);
            reject(new Error('Payment failed. Please try again.'));
          }
        }

        window.addEventListener('message', handlePaymentMessage);
        window.appendHelcimPayIframe(initData.checkoutToken);
      });
    } catch (err) {
      setPaymentError(String(err?.message || err));
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const renderStep1 = () => (
    <div className="booking-step">
      <h3>Select Location & Date</h3>
      <p>Choose your location and date to view available times.</p>

      <div className="form-group">
        <label>Location</label>
        <select
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            setSelectedDate(null);
            setSelectedSlot(null);
            setAvailableSlots([]);
            setSlotError('');
          }}
        >
          <option>Tampa</option>
          <option>Tarpon Springs</option>
        </select>
      </div>

      <div className="calendar-grid">
        {generateCalendarDays().map((day, index) => (
          <div
            key={index}
            className={`calendar-day ${day.isToday ? 'today' : ''}`}
            onClick={() => handleDateSelect(day.date)}
          >
            <div className="day-name">{day.dayName}</div>
            <div className="day-number">{day.day}</div>
            <div className="day-month">{day.month}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="booking-step">
      <h3>Select Time</h3>
      <p>
        Available times for{' '}
        {selectedDate
          ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : ''}
      </p>

      {isLoadingSlots && <p>Loading available times...</p>}
      {slotError && !isLoadingSlots && (
        <div className="appointment-summary" style={{ borderColor: '#e74c3c' }}>
          <p style={{ color: '#e74c3c' }}>{slotError}</p>
        </div>
      )}

      <div className="time-slots">
        {availableSlots.map((slot, index) => (
          <button
            key={index}
            className="time-slot"
            onClick={() => {
              setSelectedSlot(slot);
              setCurrentStep(3);
            }}
            disabled={isLoadingSlots}
          >
            {slot.label}
          </button>
        ))}
      </div>

      <button className="back-btn" onClick={() => setCurrentStep(1)}>
        ← Back to Date Selection
      </button>
    </div>
  );

  const renderStep3 = () => (
    <div className="booking-step">
      <h3>Appointment Details</h3>
      <p>Please provide your contact information.</p>

      <div className="form-group">
        <label>First Name *</label>
        <input type="text" name="firstName" value={appointmentDetails.firstName} onChange={handleInputChange} required />
      </div>

      <div className="form-group">
        <label>Last Name *</label>
        <input type="text" name="lastName" value={appointmentDetails.lastName} onChange={handleInputChange} required />
      </div>

      <div className="form-group">
        <label>Email Address *</label>
        <input type="email" name="email" value={appointmentDetails.email} onChange={handleInputChange} required />
      </div>

      <div className="form-group">
        <label>Phone Number *</label>
        <input type="tel" name="phone" value={appointmentDetails.phone} onChange={handleInputChange} required />
      </div>

      <div className="appointment-summary">
        <h4>Appointment Summary</h4>
        <p><strong>Service:</strong> {service.title}</p>
        <p><strong>ORI Code:</strong> {service.code}</p>
        <p><strong>Location:</strong> {location}</p>
        <p>
          <strong>Date:</strong>{' '}
          {selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <p><strong>Time:</strong> {selectedSlot?.label}</p>
        <p><strong>Amount:</strong> ${priceAmount.toFixed(2)} USD</p>
      </div>

      <div className="form-actions">
        <button className="back-btn" onClick={() => setCurrentStep(2)}>
          ← Back to Time Selection
        </button>
        <button className="book-btn" onClick={() => setCurrentStep(4)} disabled={!canContinueDetails}>
          Continue to Payment
        </button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="booking-step">
      <h3>Payment</h3>
      <p>Payment is required before we create your Calendly booking.</p>

      <div className="appointment-summary">
        <h4>Order</h4>
        <p><strong>Service:</strong> {service.title}</p>
        <p><strong>ORI Code:</strong> {service.code}</p>
        <p><strong>Amount:</strong> ${priceAmount.toFixed(2)} USD</p>
        <p><strong>Name:</strong> {appointmentDetails.firstName} {appointmentDetails.lastName}</p>
        <p><strong>Email:</strong> {appointmentDetails.email}</p>
        <p><strong>Phone:</strong> {appointmentDetails.phone}</p>
        <p><strong>Selected Time:</strong> {selectedSlot?.label}</p>
      </div>

      {paymentError && (
        <div className="appointment-summary" style={{ borderColor: '#e74c3c' }}>
          <p style={{ color: '#e74c3c' }}>{paymentError}</p>
        </div>
      )}

      {bookingError && (
        <div className="appointment-summary" style={{ borderColor: '#e74c3c' }}>
          <p style={{ color: '#e74c3c' }}>{bookingError}</p>
        </div>
      )}

      <div className="form-actions">
        <button className="back-btn" onClick={() => setCurrentStep(3)}>
          ← Back to Details
        </button>

        {!paymentComplete ? (
          <button className="book-btn" onClick={openHelcimPay} disabled={isProcessingPayment}>
            {isProcessingPayment ? 'Opening Checkout…' : `Pay $${priceAmount.toFixed(2)}`}
          </button>
        ) : (
          <button
            className="book-btn"
            onClick={() => createCalendlyBooking(paymentTransactionId)}
            disabled={isSavingToCalendly}
          >
            {isSavingToCalendly ? 'Saving Booking…' : 'Save Appointment in Calendly'}
          </button>
        )}
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="booking-step confirmation">
      <h3>Appointment Booked!</h3>
      <div className="confirmation-details">
        <p>Your payment is complete and your meeting is saved in Calendly.</p>
        <div className="appointment-card">
          <h4>{service.title}</h4>
          <p><strong>ORI Code:</strong> {service.code}</p>
          <p>
            <strong>Date:</strong>{' '}
            {selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <p><strong>Time:</strong> {selectedSlot?.label}</p>
          <p><strong>Client:</strong> {appointmentDetails.firstName} {appointmentDetails.lastName}</p>
          {paymentTransactionId && <p><strong>Payment Txn:</strong> {paymentTransactionId}</p>}
        </div>

        <div className="form-actions" style={{ marginTop: '1rem' }}>
          {bookingResult?.rescheduleUrl && (
            <a className="book-btn" href={bookingResult.rescheduleUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Reschedule
            </a>
          )}
          {bookingResult?.cancelUrl && (
            <a className="book-btn" href={bookingResult.cancelUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Cancel Booking
            </a>
          )}
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="booking-modal-overlay" onClick={onClose}>
      <div className="booking-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="booking-header">
          <h2>Book Appointment - {service.title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="booking-progress">
          <div className={`progress-step ${currentStep >= 1 ? 'active' : ''}`}>
            <span>1</span>
            <label>Date</label>
          </div>
          <div className={`progress-step ${currentStep >= 2 ? 'active' : ''}`}>
            <span>2</span>
            <label>Time</label>
          </div>
          <div className={`progress-step ${currentStep >= 3 ? 'active' : ''}`}>
            <span>3</span>
            <label>Details</label>
          </div>
          <div className={`progress-step ${currentStep >= 4 ? 'active' : ''}`}>
            <span>4</span>
            <label>Payment</label>
          </div>
          <div className={`progress-step ${currentStep >= 5 ? 'active' : ''}`}>
            <span>5</span>
            <label>Confirm</label>
          </div>
        </div>

        <div className="booking-body">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}
          {currentStep === 5 && renderStep5()}
        </div>
      </div>
    </div>
  );
};

export default Booking;
